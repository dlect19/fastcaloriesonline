import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface PromoEligibility {
  firstOrderDiscount: number | null;
  loyaltyDiscount: number | null;
  nextLoyaltyAt: number | null; // orders until next loyalty
}

export function usePlatformPromos() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [eligibility, setEligibility] = useState<PromoEligibility>({
    firstOrderDiscount: null,
    loyaltyDiscount: null,
    nextLoyaltyAt: null,
  });
  const [settings, setSettings] = useState({
    firstOrderEnabled: true,
    firstOrderPercent: 5,
    loyaltyEnabled: true,
    loyaltyPercent: 10,
  });

  // Fetch promo settings
  const fetchSettings = useCallback(async () => {
    try {
      const keys = [
        'promo_first_order_enabled',
        'promo_first_order_percent',
        'promo_loyalty_enabled',
        'promo_loyalty_percent',
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
      });
    } catch (error) {
      console.error('Error fetching promo settings:', error);
    }
  }, []);

  // Check user's eligibility for promos
  const checkEligibility = useCallback(async () => {
    if (!user) {
      setEligibility({ firstOrderDiscount: null, loyaltyDiscount: null, nextLoyaltyAt: null });
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

      let firstOrderDiscount: number | null = null;
      let loyaltyDiscount: number | null = null;
      let nextLoyaltyAt: number | null = null;

      // First order discount eligibility
      // Only eligible if: setting enabled, no completed orders, and promo not already used
      if (settings.firstOrderEnabled && completedOrders === 0 && !firstOrderUsed) {
        firstOrderDiscount = settings.firstOrderPercent;
      }
      // Debug logging for troubleshooting
      console.log('[PlatformPromos] Eligibility check:', {
        completedOrders,
        firstOrderUsed,
        firstOrderEnabled: settings.firstOrderEnabled,
        firstOrderDiscount,
      });

      // Loyalty discount eligibility (every 10th order)
      if (settings.loyaltyEnabled) {
        // User gets discount on their 10th, 20th, 30th, etc. order
        // Since completedOrders is AFTER delivery, we check if next order would be 10th
        const nextOrderNumber = completedOrders + 1;
        if (nextOrderNumber % 10 === 0 && nextOrderNumber > 0) {
          loyaltyDiscount = settings.loyaltyPercent;
        }
        // Calculate orders until next loyalty reward
        nextLoyaltyAt = 10 - (completedOrders % 10);
        if (nextLoyaltyAt === 10 && completedOrders > 0) {
          nextLoyaltyAt = 0; // They're eligible now
        }
      }

      setEligibility({
        firstOrderDiscount,
        loyaltyDiscount,
        nextLoyaltyAt,
      });
    } catch (error) {
      console.error('Error checking promo eligibility:', error);
    } finally {
      setLoading(false);
    }
  }, [user, settings]);

  // Get the best available platform promo for checkout
  const getBestPlatformPromo = useCallback(() => {
    // Priority: loyalty (higher %) > first order
    if (eligibility.loyaltyDiscount) {
      return {
        type: 'loyalty_10th',
        discount: eligibility.loyaltyDiscount,
        label: `${eligibility.loyaltyDiscount}% Loyalty Reward`,
      };
    }
    if (eligibility.firstOrderDiscount) {
      return {
        type: 'first_order',
        discount: eligibility.firstOrderDiscount,
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
    refreshEligibility: checkEligibility,
  };
}
