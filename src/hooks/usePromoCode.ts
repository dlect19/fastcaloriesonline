import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface PromoValidation {
  valid: boolean;
  discount: number;
  message: string;
  promoData?: any;
}

export function usePromoCode() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<any>(null);
  const [discount, setDiscount] = useState(0);

  const validatePromoCode = useCallback(async (
    code: string, 
    subtotal: number,
    vendorId?: string
  ): Promise<PromoValidation> => {
    if (!code.trim()) {
      return { valid: false, discount: 0, message: 'Please enter a promo code' };
    }

    setLoading(true);
    try {
      // For new customers: enforce one-promo-only rule
      // A "new customer" is one who has 0 completed (non-cancelled) orders
      if (user) {
        const { count: completedOrders } = await supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .not('status', 'eq', 'cancelled');

        if ((completedOrders || 0) === 0) {
          // New customer — check if they've already used any first-order promo
          const { count: promoOrders } = await supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .not('promo_code', 'is', null)
            .not('status', 'eq', 'cancelled');

          if (promoOrders && promoOrders > 0) {
            return { valid: false, discount: 0, message: 'You can only use one promo code on your first order' };
          }
        }
      }

      // 1) Check ambassador/influencer promo codes first
      const { data: ambassador } = await supabase
        .from('ambassadors')
        .select('id, name, promo_code, discount_percentage, is_active')
        .ilike('promo_code', code.trim())
        .eq('is_active', true)
        .maybeSingle();

      if (ambassador) {
        // It's an ambassador code — calculate discount as percentage of subtotal
        const discountPct = ambassador.discount_percentage ?? 10;
        let calculatedDiscount = Math.round((subtotal * discountPct) / 100);
        calculatedDiscount = Math.min(calculatedDiscount, subtotal);

        // Check if user already used any ambassador code
        if (user) {
          const { data: prevAmbOrders } = await supabase
            .from('orders')
            .select('promo_code')
            .eq('user_id', user.id)
            .not('status', 'eq', 'cancelled')
            .not('promo_code', 'is', null);

          if (prevAmbOrders && prevAmbOrders.length > 0) {
            // Check if any previous order used this ambassador code
            const usedBefore = prevAmbOrders.some(o => 
              o.promo_code?.toLowerCase() === ambassador.promo_code.toLowerCase()
            );
            if (usedBefore) {
              return { valid: false, discount: 0, message: "You've already used this ambassador code" };
            }
          }
        }

        return {
          valid: true,
          discount: calculatedDiscount,
          message: `₦${calculatedDiscount.toLocaleString()} discount (${discountPct}% off) via ${ambassador.name}!`,
          promoData: { 
            id: `amb_${ambassador.id}`, 
            code: ambassador.promo_code, 
            ambassador_id: ambassador.id,
            discount_type: 'percentage',
            discount_value: discountPct,
            is_ambassador: true,
          },
        };
      }

      // 2) Check regular promo_codes table
      let query = supabase
        .from('promo_codes')
        .select('*')
        .eq('code', code.toUpperCase())
        .eq('is_active', true);

      const { data: promos, error } = await query;

      if (error) {
        console.error('Promo query error:', error);
        return { valid: false, discount: 0, message: 'Error validating promo code' };
      }

      if (!promos || promos.length === 0) {
        return { valid: false, discount: 0, message: 'Invalid promo code' };
      }

      // Find the best matching promo
      let promo = promos.find(p => p.vendor_id === vendorId && p.scope === 'vendor');
      if (!promo) {
        promo = promos.find(p => p.scope === 'platform' || !p.vendor_id);
      }
      if (!promo) {
        promo = promos[0];
      }

      if (promo.vendor_id && promo.vendor_id !== vendorId) {
        return { valid: false, discount: 0, message: 'This promo code is not valid for this vendor' };
      }

      const now = new Date();
      if (promo.valid_from && new Date(promo.valid_from) > now) {
        return { valid: false, discount: 0, message: 'This promo code is not yet active' };
      }
      if (promo.valid_until && new Date(promo.valid_until) < now) {
        return { valid: false, discount: 0, message: 'This promo code has expired' };
      }

      if (promo.usage_limit && (promo.used_count || 0) >= promo.usage_limit) {
        return { valid: false, discount: 0, message: 'This promo code has reached its usage limit' };
      }

      const effectivePerUserLimit = promo.per_user_limit || 1;
      const resetPeriod: string = promo.per_user_reset_period || 'never';

      if (user) {
        // Compute the window start based on reset period
        let windowStart: Date | null = null;
        const now = new Date();
        if (resetPeriod === 'daily') {
          windowStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
        } else if (resetPeriod === 'weekly') {
          windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        } else if (resetPeriod === 'monthly') {
          windowStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        }

        if (windowStart) {
          // Count orders using this code within the rolling window
          const { count: recentUses } = await supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('promo_code', promo.code)
            .not('status', 'eq', 'cancelled')
            .gte('created_at', windowStart.toISOString());

          if ((recentUses || 0) >= effectivePerUserLimit) {
            const label = resetPeriod === 'daily' ? 'today' : resetPeriod === 'weekly' ? 'this week' : 'this month';
            return { valid: false, discount: 0, message: `You've already used this promo code ${label}. Try again later.` };
          }
        } else {
          // Lifetime limit (existing behavior)
          const { data: userUsage } = await supabase
            .from('promo_usage')
            .select('used_count')
            .eq('promo_id', promo.id)
            .eq('user_id', user.id)
            .maybeSingle();

          if (userUsage && userUsage.used_count >= effectivePerUserLimit) {
            return { valid: false, discount: 0, message: `You've already used this promo code` };
          }

          if (!userUsage) {
            const { count: orderUsageCount } = await supabase
              .from('orders')
              .select('id', { count: 'exact', head: true })
              .eq('user_id', user.id)
              .eq('promo_code', promo.code)
              .not('status', 'eq', 'cancelled');

            if (orderUsageCount && orderUsageCount >= effectivePerUserLimit) {
              await supabase.from('promo_usage').insert({
                promo_id: promo.id,
                user_id: user.id,
                used_count: orderUsageCount,
              });
              return { valid: false, discount: 0, message: `You've already used this promo code` };
            }
          }
        }
      }

      if (promo.min_order_amount && subtotal < promo.min_order_amount) {
        return {
          valid: false,
          discount: 0,
          message: `Minimum order of ₦${promo.min_order_amount.toLocaleString()} required`,
        };
      }

      let calculatedDiscount = 0;
      if (promo.discount_type === 'percentage') {
        calculatedDiscount = (subtotal * promo.discount_value) / 100;
        if (promo.max_discount) {
          calculatedDiscount = Math.min(calculatedDiscount, promo.max_discount);
        }
      } else {
        calculatedDiscount = promo.discount_value;
      }

      calculatedDiscount = Math.min(calculatedDiscount, subtotal);

      return {
        valid: true,
        discount: calculatedDiscount,
        message: `₦${calculatedDiscount.toLocaleString()} discount applied!`,
        promoData: promo,
      };
    } catch (error) {
      console.error('Error validating promo:', error);
      return { valid: false, discount: 0, message: 'Error validating promo code' };
    } finally {
      setLoading(false);
    }
  }, [user]);

  const applyPromo = useCallback(async (code: string, subtotal: number, vendorId?: string) => {
    const result = await validatePromoCode(code, subtotal, vendorId);
    if (result.valid) {
      setAppliedPromo(result.promoData);
      setDiscount(result.discount);
    }
    return result;
  }, [validatePromoCode]);

  const clearPromo = useCallback(() => {
    setAppliedPromo(null);
    setDiscount(0);
  }, []);

  const incrementUsage = useCallback(async (promoId: string) => {
    if (!user) return;

    try {
      // Increment total usage
      const { data: promo } = await supabase
        .from('promo_codes')
        .select('used_count')
        .eq('id', promoId)
        .single();
      
      if (promo) {
        await supabase
          .from('promo_codes')
          .update({ used_count: (promo.used_count || 0) + 1 })
          .eq('id', promoId);
      }

      // Track per-user usage
      const { data: existingUsage } = await supabase
        .from('promo_usage')
        .select('id, used_count')
        .eq('promo_id', promoId)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingUsage) {
        await supabase
          .from('promo_usage')
          .update({ 
            used_count: existingUsage.used_count + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingUsage.id);
      } else {
        await supabase
          .from('promo_usage')
          .insert({
            promo_id: promoId,
            user_id: user.id,
            used_count: 1,
          });
      }
    } catch (error) {
      console.error('Error incrementing promo usage:', error);
    }
  }, [user]);

  return {
    loading,
    appliedPromo,
    discount,
    validatePromoCode,
    applyPromo,
    clearPromo,
    incrementUsage,
    // Utility to clear state after successful order
    resetAfterOrder: useCallback(() => {
      setAppliedPromo(null);
      setDiscount(0);
    }, []),
  };
}
