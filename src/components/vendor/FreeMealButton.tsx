import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gift, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface FreeMealButtonProps {
  vendorId: string;
}

interface EligiblePromo {
  id: string;
  product_name: string;
  meal_value: number;
  vendor_name: string;
  product_image_url: string | null;
}

export function FreeMealButton({ vendorId }: FreeMealButtonProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [eligiblePromo, setEligiblePromo] = useState<EligiblePromo | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [redeeming, setRedeeming] = useState(false);

  useEffect(() => {
    if (!user || !vendorId) return;

    const checkEligibility = async () => {
      // Get active promos for this vendor
      const { data: promos } = await supabase
        .from('free_meal_promos')
        .select('id, product_name, meal_value, vendor_name, product_image_url, order_threshold, promo_period_days, max_redemptions_per_period')
        .eq('vendor_id', vendorId)
        .eq('is_active', true);

      if (!promos || promos.length === 0) return;

      // Get user progress
      const { data: progress } = await supabase
        .from('free_meal_progress')
        .select('*')
        .eq('user_id', user.id)
        .in('promo_id', promos.map(p => p.id));

      // Get redemptions
      const { data: redemptions } = await supabase
        .from('free_meal_redemptions')
        .select('promo_id, redeemed_at')
        .eq('user_id', user.id)
        .eq('status', 'redeemed');

      const now = new Date();

      for (const promo of promos) {
        const prog = progress?.find(p => p.promo_id === promo.id);
        if (!prog) continue;

        const periodStart = new Date(prog.period_start);
        const periodEnd = new Date(periodStart);
        periodEnd.setDate(periodEnd.getDate() + promo.promo_period_days);
        if (now > periodEnd) continue;

        if ((prog.highest_order_amount || 0) < promo.order_threshold) continue;

        // Check redemptions in period
        const periodRedemptions = redemptions?.filter(r => {
          if (r.promo_id !== promo.id) return false;
          const redeemedAt = new Date(r.redeemed_at);
          return redeemedAt >= periodStart && redeemedAt <= periodEnd;
        }).length || 0;

        if (periodRedemptions >= promo.max_redemptions_per_period) continue;

        // Found an eligible promo!
        setEligiblePromo({
          id: promo.id,
          product_name: promo.product_name,
          meal_value: promo.meal_value,
          vendor_name: promo.vendor_name,
          product_image_url: promo.product_image_url,
        });
        return;
      }
    };

    checkEligibility();
  }, [user, vendorId]);

  const handleRedeem = async () => {
    if (!user || !eligiblePromo) return;
    setRedeeming(true);

    try {
      // Get qualifying order
      const { data: prog } = await supabase
        .from('free_meal_progress')
        .select('qualifying_order_id')
        .eq('user_id', user.id)
        .eq('promo_id', eligiblePromo.id)
        .single();

      const { error } = await supabase
        .from('free_meal_redemptions')
        .insert({
          user_id: user.id,
          promo_id: eligiblePromo.id,
          qualifying_order_id: prog?.qualifying_order_id || null,
          meal_value: eligiblePromo.meal_value,
          status: 'redeemed',
        });

      if (error) throw error;

      toast({
        title: '🎉 Free Meal Claimed!',
        description: `Your ${eligiblePromo.product_name} has been redeemed. Proceed to checkout!`,
      });

      setConfirmOpen(false);
      setEligiblePromo(null);
      // Navigate to checkout with free meal
      navigate('/cart');
    } catch (err) {
      toast({
        title: 'Failed to redeem',
        description: 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setRedeeming(false);
    }
  };

  if (!eligiblePromo) return null;

  return (
    <>
      <div className="container py-3">
        <button
          onClick={() => setConfirmOpen(true)}
          className="w-full flex items-center gap-3 p-4 rounded-2xl bg-gradient-to-r from-green-500/15 via-emerald-500/10 to-teal-500/15 border border-green-500/30 hover:border-green-500/50 transition-all"
        >
          <div className="w-12 h-12 rounded-xl bg-green-500/20 flex items-center justify-center shrink-0">
            <Gift className="w-6 h-6 text-green-600" />
          </div>
          <div className="flex-1 text-left min-w-0">
            <p className="font-bold text-green-700 dark:text-green-400 text-sm">
              🎉 Take Your Free Meal Now!
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {eligiblePromo.product_name} worth ₦{eligiblePromo.meal_value.toLocaleString()} — Tap to claim
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-green-600 shrink-0" />
        </button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-green-600" />
              Claim Your Free Meal?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You're about to claim <strong>{eligiblePromo.product_name}</strong> (worth ₦{eligiblePromo.meal_value.toLocaleString()}) from <strong>{eligiblePromo.vendor_name}</strong>.
              You'll be taken to checkout with this meal. This can only be used once per promo period.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRedeem}
              disabled={redeeming}
              className="bg-green-600 hover:bg-green-700"
            >
              {redeeming ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Gift className="w-4 h-4 mr-2" />}
              Claim Free Meal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
