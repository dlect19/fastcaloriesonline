import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export interface FreeMealPromo {
  id: string;
  vendor_id: string;
  outlet_id: string | null;
  product_id: string;
  product_name: string;
  product_image_url: string | null;
  vendor_name: string;
  meal_value: number;
  order_threshold: number;
  promo_period_days: number;
  max_redemptions_per_period: number;
  is_active: boolean;
  banner_image_url: string | null;
  banner_text: string | null;
  created_at: string;
}

export interface FreeMealProgress {
  promo_id: string;
  highest_order_amount: number;
  is_eligible: boolean;
  period_start: string;
  qualifying_order_id: string | null;
}

export interface FreeMealWithProgress extends FreeMealPromo {
  progress: FreeMealProgress | null;
  redemptions_in_period: number;
  can_redeem: boolean;
  progress_percent: number;
}

export function useFreeMealPromos() {
  const { user } = useAuth();
  const [promos, setPromos] = useState<FreeMealWithProgress[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPromos = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch active promos
      const { data: activePromos, error: promosError } = await supabase
        .from('free_meal_promos')
        .select('*')
        .eq('is_active', true)
        .order('meal_value', { ascending: true });

      if (promosError) throw promosError;
      if (!activePromos || activePromos.length === 0) {
        setPromos([]);
        setLoading(false);
        return;
      }

      if (!user) {
        // Not logged in - show promos without progress
        setPromos(activePromos.map(p => ({
          ...p,
          progress: null,
          redemptions_in_period: 0,
          can_redeem: false,
          progress_percent: 0,
        })));
        setLoading(false);
        return;
      }

      // Fetch user progress for all promos
      const { data: progressData } = await supabase
        .from('free_meal_progress')
        .select('*')
        .eq('user_id', user.id);

      // Fetch redemptions in current period
      const { data: redemptionsData } = await supabase
        .from('free_meal_redemptions')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'redeemed');

      const promosWithProgress: FreeMealWithProgress[] = activePromos.map(promo => {
        const progress = progressData?.find(p => p.promo_id === promo.id) || null;
        
        // Check if progress period is still valid
        const periodStart = progress?.period_start ? new Date(progress.period_start) : new Date();
        const periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + promo.promo_period_days);
        const now = new Date();
        const isPeriodValid = now <= periodEnd;

        // Count redemptions in current period
        const periodRedemptions = redemptionsData?.filter(r => {
          if (r.promo_id !== promo.id) return false;
          const redeemedAt = new Date(r.redeemed_at);
          return isPeriodValid && redeemedAt >= periodStart && redeemedAt <= periodEnd;
        }).length || 0;

        const highestOrder = isPeriodValid ? (progress?.highest_order_amount || 0) : 0;
        const isEligible = highestOrder >= promo.order_threshold;
        const canRedeem = isEligible && periodRedemptions < promo.max_redemptions_per_period;
        const progressPercent = Math.min((highestOrder / promo.order_threshold) * 100, 100);

        return {
          ...promo,
          progress: isPeriodValid ? progress : null,
          redemptions_in_period: periodRedemptions,
          can_redeem: canRedeem,
          progress_percent: progressPercent,
        };
      });

      setPromos(promosWithProgress);
    } catch (error) {
      console.error('Error fetching free meal promos:', error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Update progress when an order is placed (call from checkout)
  const updateProgress = useCallback(async (orderAmount: number, orderId: string) => {
    if (!user) return;

    try {
      // Get all active promos
      const { data: activePromos } = await supabase
        .from('free_meal_promos')
        .select('*')
        .eq('is_active', true);

      if (!activePromos) return;

      for (const promo of activePromos) {
        // Get or create progress
        const { data: existing } = await supabase
          .from('free_meal_progress')
          .select('*')
          .eq('user_id', user.id)
          .eq('promo_id', promo.id)
          .maybeSingle();

        // Check period validity
        const now = new Date();
        let periodValid = false;
        if (existing?.period_start) {
          const periodEnd = new Date(existing.period_start);
          periodEnd.setDate(periodEnd.getDate() + promo.promo_period_days);
          periodValid = now <= periodEnd;
        }

        if (existing && periodValid) {
          // Update if this order is higher
          if (orderAmount > (existing.highest_order_amount || 0)) {
            await supabase
              .from('free_meal_progress')
              .update({
                highest_order_amount: orderAmount,
                qualifying_order_id: orderId,
                is_eligible: orderAmount >= promo.order_threshold,
                updated_at: now.toISOString(),
              })
              .eq('id', existing.id);
          }
        } else {
          // Create new or reset period
          const periodEnd = new Date();
          periodEnd.setDate(periodEnd.getDate() + promo.promo_period_days);
          
          await supabase
            .from('free_meal_progress')
            .upsert({
              user_id: user.id,
              promo_id: promo.id,
              highest_order_amount: orderAmount,
              qualifying_order_id: orderId,
              period_start: now.toISOString(),
              is_eligible: orderAmount >= promo.order_threshold,
              updated_at: now.toISOString(),
            }, { onConflict: 'user_id,promo_id' });

          // Create audit record for journey tracking
          await supabase
            .from('free_meal_audit')
            .insert({
              promo_id: promo.id,
              user_id: user.id,
              status: orderAmount >= promo.order_threshold ? 'qualified' : 'in_progress',
              qualifying_order_id: orderId,
              meal_value: promo.meal_value,
              platform_cost: promo.meal_value,
              period_start: now.toISOString(),
              period_end: periodEnd.toISOString(),
              qualified_at: orderAmount >= promo.order_threshold ? now.toISOString() : null,
              notes: `Customer started free meal journey with order ₦${orderAmount.toLocaleString()}`,
              environment: 'production',
            });
        }
      }

      // Refresh promos
      await fetchPromos();
    } catch (error) {
      console.error('Error updating free meal progress:', error);
    }
  }, [user, fetchPromos]);

  // Redeem a free meal
  const redeemFreeMeal = useCallback(async (promoId: string, qualifyingOrderId?: string) => {
    if (!user) return null;

    try {
      const promo = promos.find(p => p.id === promoId);
      if (!promo || !promo.can_redeem) return null;

      const qOrderId = qualifyingOrderId || promo.progress?.qualifying_order_id || null;

      // Guard: check that the qualifying order is at least 'preparing' so user can't cancel it after claiming
      if (qOrderId) {
        const { data: qOrder } = await supabase
          .from('orders')
          .select('status')
          .eq('id', qOrderId)
          .maybeSingle();

        const nonCancellableStatuses = ['preparing', 'ready_for_pickup', 'searching_for_rider', 'picked_up', 'on_the_way', 'delivered'];
        if (!qOrder || !nonCancellableStatuses.includes(qOrder.status)) {
          console.warn('Qualifying order is still cancellable, blocking redemption');
          return { error: 'Your qualifying order must be at least in "Preparing" status before you can claim your free meal. This prevents abuse.' };
        }
      }

      const { data, error } = await supabase
        .from('free_meal_redemptions')
        .insert({
          user_id: user.id,
          promo_id: promoId,
          qualifying_order_id: qOrderId,
          meal_value: promo.meal_value,
          status: 'redeemed',
        })
        .select()
        .single();

      if (error) throw error;

      // Create audit record for tracking & vendor payment
      const periodStart = promo.progress?.period_start ? new Date(promo.progress.period_start) : new Date();
      const periodEnd = new Date(periodStart);
      periodEnd.setDate(periodEnd.getDate() + promo.promo_period_days);

      await supabase
        .from('free_meal_audit')
        .insert({
          promo_id: promoId,
          user_id: user.id,
          status: 'claimed',
          qualifying_order_id: qOrderId,
          redemption_id: data.id,
          meal_value: promo.meal_value,
          platform_cost: promo.meal_value,
          vendor_credit: promo.meal_value,
          period_start: periodStart.toISOString(),
          period_end: periodEnd.toISOString(),
          qualified_at: promo.progress?.period_start || new Date().toISOString(),
          claimed_at: new Date().toISOString(),
          notes: `Free meal claimed: ${promo.product_name} from ${promo.vendor_name}`,
          environment: 'production',
        });

      // Refresh
      await fetchPromos();
      return data;
    } catch (error) {
      console.error('Error redeeming free meal:', error);
      return null;
    }
  }, [user, promos, fetchPromos]);

  useEffect(() => {
    fetchPromos();
  }, [fetchPromos]);

  // Check if there's any available free meal (for banner)
  const hasAvailableFreeMeal = promos.some(p => p.can_redeem);
  const hasActivePromos = promos.length > 0;

  return {
    promos,
    loading,
    hasAvailableFreeMeal,
    hasActivePromos,
    updateProgress,
    redeemFreeMeal,
    refreshPromos: fetchPromos,
  };
}
