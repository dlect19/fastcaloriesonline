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
      // Build query - check for matching code that is active
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
      // Priority: vendor-specific promo for this vendor > platform promo
      let promo = promos.find(p => p.vendor_id === vendorId && p.scope === 'vendor');
      if (!promo) {
        promo = promos.find(p => p.scope === 'platform' || !p.vendor_id);
      }
      if (!promo) {
        promo = promos[0]; // Fallback
      }

      // Check if vendor-specific promo matches the current vendor
      if (promo.vendor_id && promo.vendor_id !== vendorId) {
        return { valid: false, discount: 0, message: 'This promo code is not valid for this vendor' };
      }

      // Check validity dates
      const now = new Date();
      if (promo.valid_from && new Date(promo.valid_from) > now) {
        return { valid: false, discount: 0, message: 'This promo code is not yet active' };
      }
      if (promo.valid_until && new Date(promo.valid_until) < now) {
        return { valid: false, discount: 0, message: 'This promo code has expired' };
      }

      // Check total usage limit
      if (promo.usage_limit && (promo.used_count || 0) >= promo.usage_limit) {
        return { valid: false, discount: 0, message: 'This promo code has reached its usage limit' };
      }

      // Check per-user usage limit (default to 1 use per user if not set)
      const effectivePerUserLimit = promo.per_user_limit || 1;
      if (user) {
        // Check promo_usage table first
        const { data: userUsage } = await supabase
          .from('promo_usage')
          .select('used_count')
          .eq('promo_id', promo.id)
          .eq('user_id', user.id)
          .maybeSingle();

        if (userUsage && userUsage.used_count >= effectivePerUserLimit) {
          return { 
            valid: false, 
            discount: 0, 
            message: `You've already used this promo code` 
          };
        }

        // Fallback: also check orders table for this promo code usage
        if (!userUsage) {
          const { count: orderUsageCount } = await supabase
            .from('orders')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', user.id)
            .eq('promo_code', promo.code)
            .not('status', 'eq', 'cancelled');

          if (orderUsageCount && orderUsageCount >= effectivePerUserLimit) {
            // Backfill promo_usage record
            await supabase.from('promo_usage').insert({
              promo_id: promo.id,
              user_id: user.id,
              used_count: orderUsageCount,
            });
            return { 
              valid: false, 
              discount: 0, 
              message: `You've already used this promo code` 
            };
          }
        }
      }

      // Check minimum order amount
      if (promo.min_order_amount && subtotal < promo.min_order_amount) {
        return {
          valid: false,
          discount: 0,
          message: `Minimum order of ₦${promo.min_order_amount.toLocaleString()} required`,
        };
      }

      // Calculate discount
      let calculatedDiscount = 0;
      if (promo.discount_type === 'percentage') {
        calculatedDiscount = (subtotal * promo.discount_value) / 100;
        if (promo.max_discount) {
          calculatedDiscount = Math.min(calculatedDiscount, promo.max_discount);
        }
      } else {
        calculatedDiscount = promo.discount_value;
      }

      // Ensure discount doesn't exceed subtotal
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
