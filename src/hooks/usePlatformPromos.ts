import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface PromoEligibility {
  firstOrderDiscount: number | null;
  loyaltyDiscount: number | null;
  nextLoyaltyAt: number | null; // orders until next loyalty
  // Pharmacy-specific (funded by service charge, not vendor margin)
  pharmacyWelcomeType: 'percent' | 'fixed' | null;
  pharmacyWelcomeValue: number | null;
}

interface PlatformPromoSettings {
  firstOrderEnabled: boolean;
  firstOrderPercent: number;
  loyaltyEnabled: boolean;
  loyaltyPercent: number;
  pharmacyWelcomeEnabled: boolean;
  pharmacyWelcomeType: 'percent' | 'fixed';
  pharmacyWelcomePercent: number;
  pharmacyWelcomeFixed: number;
}

export function usePlatformPromos() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [eligibility, setEligibility] = useState<PromoEligibility>({
    firstOrderDiscount: null,
    loyaltyDiscount: null,
    nextLoyaltyAt: null,
    pharmacyWelcomeType: null,
    pharmacyWelcomeValue: null,
  });
  const [settings, setSettings] = useState<PlatformPromoSettings>({
    firstOrderEnabled: true,
    firstOrderPercent: 5,
    loyaltyEnabled: true,
    loyaltyPercent: 10,
    pharmacyWelcomeEnabled: true,
    pharmacyWelcomeType: 'percent',
    pharmacyWelcomePercent: 5,
    pharmacyWelcomeFixed: 200,
  });

  // Fetch promo settings
  const fetchSettings = useCallback(async () => {
    try {
      const keys = [
        'promo_first_order_enabled',
        'promo_first_order_percent',
        'promo_loyalty_enabled',
        'promo_loyalty_percent',
        'pharmacy_welcome_enabled',
        'pharmacy_welcome_type',
        'pharmacy_welcome_percent',
        'pharmacy_welcome_fixed',
      ];

      const { data, error } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', keys);

      if (error) throw error;

      const settingsMap: Record<string, string> = {};
      data?.forEach(s => { settingsMap[s.key] = s.value; });

      setSettings({
        firstOrderEnabled: settingsMap['promo_first_order_enabled'] === 'true',
        firstOrderPercent: parseInt(settingsMap['promo_first_order_percent'] || '5'),
        loyaltyEnabled: settingsMap['promo_loyalty_enabled'] === 'true',
        loyaltyPercent: parseInt(settingsMap['promo_loyalty_percent'] || '10'),
        pharmacyWelcomeEnabled: settingsMap['pharmacy_welcome_enabled'] === 'true',
        pharmacyWelcomeType: (settingsMap['pharmacy_welcome_type'] as 'percent' | 'fixed') || 'percent',
        pharmacyWelcomePercent: parseInt(settingsMap['pharmacy_welcome_percent'] || '5'),
        pharmacyWelcomeFixed: parseInt(settingsMap['pharmacy_welcome_fixed'] || '200'),
      });
    } catch (error) {
      console.error('Error fetching promo settings:', error);
    }
  }, []);

  // Check user's eligibility for promos
  const checkEligibility = useCallback(async () => {
    if (!user) {
      setEligibility({
        firstOrderDiscount: null,
        loyaltyDiscount: null,
        nextLoyaltyAt: null,
        pharmacyWelcomeType: null,
        pharmacyWelcomeValue: null,
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // Get user's order stats - use maybeSingle to handle no record case
      const { data: stats, error } = await supabase
        .from('user_order_stats')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      // If error or no stats, treat as new user
      const completedOrders = stats?.completed_orders ?? 0;
      const firstOrderUsed = stats?.first_order_promo_used ?? false;
      let firstPharmacyUsed = (stats as any)?.first_pharmacy_order_promo_used ?? false;

      // Belt-and-braces: even if the flag was never set (client crashed / older
      // order flow), any existing pharmacy order for this user disqualifies
      // them from the pharmacy welcome bonus. This prevents the promo from
      // being auto-applied on the customer's 2nd, 3rd, ... pharmacy order.
      if (!firstPharmacyUsed) {
        const { count: pharmacyOrderCount } = await supabase
          .from('orders')
          .select('id, vendors!inner(category)', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('vendors.category', 'pharmacy');
        if ((pharmacyOrderCount || 0) > 0) {
          firstPharmacyUsed = true;
        }
      }

      let firstOrderDiscount: number | null = null;
      let loyaltyDiscount: number | null = null;
      let nextLoyaltyAt: number | null = null;
      let pharmacyWelcomeType: 'percent' | 'fixed' | null = null;
      let pharmacyWelcomeValue: number | null = null;

      // First order discount eligibility (for non-pharmacy)
      if (settings.firstOrderEnabled && completedOrders === 0 && !firstOrderUsed) {
        firstOrderDiscount = settings.firstOrderPercent;
      }

      // Pharmacy welcome eligibility (any customer's first pharmacy order)
      if (settings.pharmacyWelcomeEnabled && !firstPharmacyUsed) {
        pharmacyWelcomeType = settings.pharmacyWelcomeType;
        pharmacyWelcomeValue =
          settings.pharmacyWelcomeType === 'percent'
            ? settings.pharmacyWelcomePercent
            : settings.pharmacyWelcomeFixed;
      }

      // Loyalty discount eligibility (every 10th order)
      if (settings.loyaltyEnabled) {
        const nextOrderNumber = completedOrders + 1;
        if (nextOrderNumber % 10 === 0 && nextOrderNumber > 0) {
          loyaltyDiscount = settings.loyaltyPercent;
        }
        nextLoyaltyAt = 10 - (completedOrders % 10);
        if (nextLoyaltyAt === 10 && completedOrders > 0) {
          nextLoyaltyAt = 0;
        }
      }

      setEligibility({
        firstOrderDiscount,
        loyaltyDiscount,
        nextLoyaltyAt,
        pharmacyWelcomeType,
        pharmacyWelcomeValue,
      });
    } catch (error) {
      console.error('Error checking promo eligibility:', error);
    } finally {
      setLoading(false);
    }
  }, [user, settings]);

  // Get the best available platform promo for checkout
  // isPharmacy=true returns ONLY the pharmacy welcome bonus (existing welcome/loyalty are blocked).
  // isPharmacy=false returns loyalty/first-order promos (pharmacy bonus is excluded).
  const getBestPlatformPromo = useCallback((isPharmacy: boolean = false) => {
    if (isPharmacy) {
      if (eligibility.pharmacyWelcomeValue && eligibility.pharmacyWelcomeType) {
        return {
          type: 'pharmacy_welcome',
          discount: eligibility.pharmacyWelcomeValue,
          discountKind: eligibility.pharmacyWelcomeType, // 'percent' | 'fixed'
          label:
            eligibility.pharmacyWelcomeType === 'percent'
              ? `${eligibility.pharmacyWelcomeValue}% Pharmacy Welcome Bonus`
              : `₦${eligibility.pharmacyWelcomeValue} Pharmacy Welcome Bonus`,
        };
      }
      return null;
    }

    // Non-pharmacy carts: loyalty > first order
    if (eligibility.loyaltyDiscount) {
      return {
        type: 'loyalty_10th',
        discount: eligibility.loyaltyDiscount,
        discountKind: 'percent' as const,
        label: `${eligibility.loyaltyDiscount}% Loyalty Reward`,
      };
    }
    if (eligibility.firstOrderDiscount) {
      return {
        type: 'first_order',
        discount: eligibility.firstOrderDiscount,
        discountKind: 'percent' as const,
        label: `${eligibility.firstOrderDiscount}% First Order Discount`,
      };
    }
    return null;
  }, [eligibility]);

  // Mark first order promo as used
  const markFirstOrderUsed = useCallback(async () => {
    if (!user) return;

    try {
      await supabase
        .from('user_order_stats')
        .upsert({
          user_id: user.id,
          first_order_promo_used: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });
    } catch (error) {
      console.error('Error marking first order promo used:', error);
    }
  }, [user]);

  // Mark first pharmacy order promo as used
  const markFirstPharmacyOrderUsed = useCallback(async () => {
    if (!user) return;

    try {
      await supabase
        .from('user_order_stats')
        .upsert({
          user_id: user.id,
          first_pharmacy_order_promo_used: true,
          updated_at: new Date().toISOString(),
        } as any, { onConflict: 'user_id' });
    } catch (error) {
      console.error('Error marking first pharmacy order promo used:', error);
    }
  }, [user]);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    if (settings) {
      checkEligibility();
    }
  }, [settings, checkEligibility]);

  return {
    loading,
    eligibility,
    settings,
    getBestPlatformPromo,
    markFirstOrderUsed,
    markFirstPharmacyOrderUsed,
    refreshEligibility: checkEligibility,
  };
}
