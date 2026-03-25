import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gift, Clock, CheckCircle2, Store, UtensilsCrossed } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

interface PromoProgress {
  id: string;
  product_name: string;
  product_image_url: string | null;
  vendor_name: string;
  meal_value: number;
  order_threshold: number;
  promo_period_days: number;
  progress_percent: number;
  highest_order: number;
  can_redeem: boolean;
  already_redeemed: boolean;
}

interface VendorFreeMealProgressProps {
  vendorId: string;
  cartTotal?: number;
}

export function VendorFreeMealProgress({ vendorId, cartTotal = 0 }: VendorFreeMealProgressProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [promos, setPromos] = useState<PromoProgress[]>([]);

  useEffect(() => {
    if (!user || !vendorId) return;

    const fetch = async () => {
      // Gate: Only show free meal progress if user has claimed their welcome bonus
      const { data: orderStats } = await supabase
        .from('user_order_stats')
        .select('first_order_promo_used')
        .eq('user_id', user.id)
        .maybeSingle();

      if (!orderStats?.first_order_promo_used) return;

      const { data: activePromos } = await supabase
        .from('free_meal_promos')
        .select('id, product_name, product_image_url, vendor_name, meal_value, order_threshold, promo_period_days, max_redemptions_per_period')
        .eq('vendor_id', vendorId)
        .eq('is_active', true);

      if (!activePromos || activePromos.length === 0) return;

      const { data: progressData } = await supabase
        .from('free_meal_progress')
        .select('*')
        .eq('user_id', user.id)
        .in('promo_id', activePromos.map(p => p.id));

      const { data: redemptions } = await supabase
        .from('free_meal_redemptions')
        .select('promo_id, redeemed_at')
        .eq('user_id', user.id)
        .eq('status', 'redeemed');

      const now = new Date();
      const results: PromoProgress[] = [];

      for (const promo of activePromos) {
        const progress = progressData?.find(p => p.promo_id === promo.id);
        const periodStart = progress?.period_start ? new Date(progress.period_start) : null;
        const periodEnd = periodStart ? new Date(periodStart) : null;
        if (periodEnd) periodEnd.setDate(periodEnd.getDate() + promo.promo_period_days);
        const isPeriodValid = periodEnd ? now <= periodEnd : false;

        const dbHighest = isPeriodValid ? (progress?.highest_order_amount || 0) : 0;
        const highestOrder = Math.max(dbHighest, cartTotal);
        const progressPercent = Math.min((highestOrder / promo.order_threshold) * 100, 100);

        const periodRedemptions = redemptions?.filter(r => {
          if (r.promo_id !== promo.id || !periodStart || !periodEnd) return false;
          const d = new Date(r.redeemed_at);
          return d >= periodStart && d <= periodEnd;
        }).length || 0;

        const isEligible = highestOrder >= promo.order_threshold;
        const canRedeem = isEligible && periodRedemptions < promo.max_redemptions_per_period;
        const alreadyRedeemed = isEligible && periodRedemptions >= promo.max_redemptions_per_period;

        // Hide promos that have already been redeemed in this period
        if (alreadyRedeemed) continue;

        results.push({
          id: promo.id,
          product_name: promo.product_name,
          product_image_url: promo.product_image_url,
          vendor_name: promo.vendor_name,
          meal_value: promo.meal_value,
          order_threshold: promo.order_threshold,
          promo_period_days: promo.promo_period_days,
          progress_percent: progressPercent,
          highest_order: highestOrder,
          can_redeem: canRedeem,
          already_redeemed: false,
        });
      }

      setPromos(results);
    };

    fetch();
  }, [user, vendorId, cartTotal]);

  if (promos.length === 0) return null;

  const getTierBadge = (value: number) => {
    if (value >= 3500) return { label: 'Gold', className: 'bg-yellow-500/20 text-yellow-700 dark:text-yellow-400' };
    if (value >= 2500) return { label: 'Silver', className: 'bg-purple-500/20 text-purple-700 dark:text-purple-400' };
    return { label: 'Bronze', className: 'bg-blue-500/20 text-blue-700 dark:text-blue-400' };
  };

  return (
    <div className="container py-2 space-y-2">
      {promos.map(promo => {
        const tier = getTierBadge(promo.meal_value);
        return (
          <button
            key={promo.id}
            onClick={() => navigate('/free-meals')}
            className="w-full text-left rounded-xl border border-border bg-card p-3 hover:bg-accent/50 transition-colors"
          >
            <div className="flex items-center gap-3">
              {promo.product_image_url ? (
                <img
                  src={promo.product_image_url}
                  alt={promo.product_name}
                  className="w-10 h-10 rounded-lg object-cover shrink-0"
                />
              ) : (
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                  <UtensilsCrossed className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold truncate">{promo.product_name}</span>
                  <Badge className={`${tier.className} text-[10px] px-1.5 py-0`}>{tier.label}</Badge>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <Progress value={promo.progress_percent} className="h-2 flex-1" />
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    {promo.progress_percent >= 100 ? (
                      <span className="text-green-600 font-semibold flex items-center gap-0.5">
                        <CheckCircle2 className="w-3 h-3" /> Unlocked
                      </span>
                    ) : (
                      `${Math.round(promo.progress_percent)}%`
                    )}
                  </span>
                </div>
              </div>
              <Gift className="w-4 h-4 text-green-600 shrink-0" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
