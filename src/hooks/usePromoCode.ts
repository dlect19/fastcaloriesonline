import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface PromoValidation {
  valid: boolean;
  discount: number;
  message: string;
  promoData?: any;
}

export function usePromoCode() {
  const [loading, setLoading] = useState(false);
  const [appliedPromo, setAppliedPromo] = useState<any>(null);
  const [discount, setDiscount] = useState(0);

  const validatePromoCode = useCallback(async (code: string, subtotal: number): Promise<PromoValidation> => {
    if (!code.trim()) {
      return { valid: false, discount: 0, message: 'Please enter a promo code' };
    }

    setLoading(true);
    try {
      const { data: promo, error } = await supabase
        .from('promo_codes')
        .select('*')
        .eq('code', code.toUpperCase())
        .eq('is_active', true)
        .maybeSingle();

      if (error || !promo) {
        return { valid: false, discount: 0, message: 'Invalid promo code' };
      }

      // Check validity dates
      const now = new Date();
      if (promo.valid_from && new Date(promo.valid_from) > now) {
        return { valid: false, discount: 0, message: 'This promo code is not yet active' };
      }
      if (promo.valid_until && new Date(promo.valid_until) < now) {
        return { valid: false, discount: 0, message: 'This promo code has expired' };
      }

      // Check usage limit
      if (promo.usage_limit && promo.used_count >= promo.usage_limit) {
        return { valid: false, discount: 0, message: 'This promo code has reached its usage limit' };
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
  }, []);

  const applyPromo = useCallback(async (code: string, subtotal: number) => {
    const result = await validatePromoCode(code, subtotal);
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
    try {
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
    } catch (error) {
      console.error('Error incrementing promo usage:', error);
    }
  }, []);

  return {
    loading,
    appliedPromo,
    discount,
    validatePromoCode,
    applyPromo,
    clearPromo,
    incrementUsage,
  };
}
