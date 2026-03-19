import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useFreeMealPromos, FreeMealWithProgress } from '@/hooks/useFreeMealPromos';
import { useAuth } from '@/hooks/useAuth';
import { useCart } from '@/hooks/useCart';
import { useToast } from '@/hooks/use-toast';
import { ArrowLeft, Gift, Utensils, Clock, CheckCircle2, Store, UtensilsCrossed } from 'lucide-react';
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

export default function FreeMeals() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const { promos, loading, redeemFreeMeal, refreshPromos } = useFreeMealPromos();
  const { vendorGroups } = useCart();
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [confirmPromo, setConfirmPromo] = useState<FreeMealWithProgress | null>(null);

  // Build a map of vendor cart subtotals (sum across all outlets)
  const vendorCartTotals = new Map<string, number>();
  vendorGroups.forEach(g => {
    vendorCartTotals.set(g.vendorId, (vendorCartTotals.get(g.vendorId) || 0) + g.subtotal);
  });

  const handleRedeem = async (promo: FreeMealWithProgress) => {
    setConfirmPromo(promo);
  };

  const confirmRedeem = async () => {
    if (!confirmPromo) return;
    setRedeemingId(confirmPromo.id);
    const result = await redeemFreeMeal(confirmPromo.id);
    if (result) {
      toast({
        title: '🎉 Free Meal Redeemed!',
        description: `Your ${confirmPromo.product_name} has been claimed. Proceed to checkout!`,
      });
      // Navigate to cart/checkout
      navigate('/cart');
    } else {
      toast({
        title: 'Redemption Failed',
        description: 'Could not redeem at this time. Please try again.',
        variant: 'destructive',
      });
    }
    setRedeemingId(null);
    setConfirmPromo(null);
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <Gift className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-bold mb-2">Login to Access Free Meals</h2>
            <p className="text-muted-foreground mb-4">
              Sign in to see available free meal promos and track your progress!
            </p>
            <Button onClick={() => navigate('/auth')}>Login Now</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-green-500/20 via-emerald-500/10 to-teal-500/5 px-4 pt-12 pb-8">
        <div className="max-w-lg mx-auto">
          <Button variant="ghost" size="icon" className="mb-4" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Gift className="w-7 h-7 text-green-600" />
            Free Meal Promos
          </h1>
          <p className="text-muted-foreground mt-1">
            Order enough food and unlock amazing free meals! 🍽️
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 -mt-4 space-y-4">
        {loading ? (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-muted-foreground">Loading promos...</p>
          </div>
        ) : promos.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center">
              <Utensils className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
              <p className="font-medium">No free meal promos right now</p>
              <p className="text-sm text-muted-foreground mt-1">Check back later for new offers!</p>
            </CardContent>
          </Card>
        ) : (
          promos
            .filter(promo => {
              // Hide promos already redeemed in current period
              const cartTotal = vendorCartTotals.get(promo.vendor_id) || 0;
              const effectiveHighest = Math.max(promo.progress?.highest_order_amount || 0, cartTotal);
              const isEligible = effectiveHighest >= promo.order_threshold;
              const alreadyRedeemed = isEligible && promo.redemptions_in_period >= promo.max_redemptions_per_period;
              return !alreadyRedeemed;
            })
            .map(promo => {
            const cartTotal = vendorCartTotals.get(promo.vendor_id) || 0;
            const effectiveHighest = Math.max(promo.progress?.highest_order_amount || 0, cartTotal);
            const adjustedPercent = Math.min((effectiveHighest / promo.order_threshold) * 100, 100);
            const adjustedPromo = {
              ...promo,
              progress_percent: adjustedPercent,
              can_redeem: effectiveHighest >= promo.order_threshold && promo.redemptions_in_period < promo.max_redemptions_per_period,
            };
            return (
              <FreeMealCard
                key={promo.id}
                promo={adjustedPromo}
                cartTotal={cartTotal}
                onRedeem={handleRedeem}
                isRedeeming={redeemingId === promo.id}
                onViewVendor={() => navigate(`/vendor/${promo.vendor_id}`)}
              />
            );
          })
        )}

        {/* How it Works */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How Free Meals Work</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center text-xs font-bold text-green-600 shrink-0">1</div>
              <p>Browse available free meals and see the <strong>minimum order threshold</strong> you need to meet.</p>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center text-xs font-bold text-green-600 shrink-0">2</div>
              <p>Place an order worth at least the threshold amount (in a <strong>single order</strong>).</p>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center text-xs font-bold text-green-600 shrink-0">3</div>
              <p>Once your order meets the threshold, your <strong>free meal is unlocked!</strong> Come back here to claim it.</p>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center text-xs font-bold text-green-600 shrink-0">4</div>
              <p>You can redeem <strong>once per promo period</strong>. The progress resets each period.</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Confirm Dialog */}
      <AlertDialog open={!!confirmPromo} onOpenChange={() => setConfirmPromo(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-green-600" />
              Claim Your Free Meal?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You're about to claim <strong>{confirmPromo?.product_name}</strong> (worth ₦{confirmPromo?.meal_value.toLocaleString()}) from <strong>{confirmPromo?.vendor_name}</strong>.
              You'll be redirected to the vendor's page to place your order with the free meal.
              This can only be used once per promo period.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRedeem} className="bg-green-600 hover:bg-green-700">
              Claim Free Meal
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FreeMealCard({
  promo,
  cartTotal = 0,
  onRedeem,
  isRedeeming,
  onViewVendor,
}: {
  promo: FreeMealWithProgress;
  cartTotal?: number;
  onRedeem: (p: FreeMealWithProgress) => void;
  isRedeeming: boolean;
  onViewVendor: () => void;
}) {
  const tierColor = promo.meal_value >= 3500
    ? 'from-yellow-500/20 to-amber-500/10 border-yellow-500/30'
    : promo.meal_value >= 2500
    ? 'from-purple-500/20 to-violet-500/10 border-purple-500/30'
    : 'from-blue-500/20 to-sky-500/10 border-blue-500/30';

  const tierBadge = promo.meal_value >= 3500
    ? { label: 'Gold', className: 'bg-yellow-500/20 text-yellow-700' }
    : promo.meal_value >= 2500
    ? { label: 'Silver', className: 'bg-purple-500/20 text-purple-700' }
    : { label: 'Bronze', className: 'bg-blue-500/20 text-blue-700' };

  return (
    <Card className={`overflow-hidden border bg-gradient-to-br ${tierColor}`}>
      <CardContent className="p-0">
        {/* Image section */}
        <div className="flex gap-3 p-4">
          {promo.product_image_url ? (
            <img
              src={promo.product_image_url}
              alt={promo.product_name}
              className="w-20 h-20 rounded-xl object-cover shrink-0"
            />
          ) : (
            <div className="w-20 h-20 rounded-xl bg-secondary flex items-center justify-center shrink-0">
              <UtensilsCrossed className="w-8 h-8 text-muted-foreground" />
            </div>
          )}

          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-foreground">{promo.product_name}</h3>
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Store className="w-3 h-3" />
                  {promo.vendor_name}
                </p>
              </div>
              <Badge className={`${tierBadge.className} text-xs`}>
                {tierBadge.label}
              </Badge>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <span className="text-lg font-bold text-green-600">
                FREE
              </span>
              <span className="text-sm text-muted-foreground line-through">
                ₦{promo.meal_value.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Progress section */}
        <div className="px-4 pb-4 space-y-3">
          {/* Threshold info */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              Order ₦{promo.order_threshold.toLocaleString()} in a single order to unlock
            </span>
            <span className="text-muted-foreground flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {promo.promo_period_days}d period
            </span>
          </div>

          {/* Progress bar */}
          <div className="space-y-1">
            <Progress value={promo.progress_percent} className="h-3" />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {promo.progress_percent >= 100 ? (
                  <span className="text-green-600 font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> Threshold met!
                  </span>
                ) : cartTotal > 0 ? (
                  `₦${Math.round(cartTotal).toLocaleString()} in cart`
                ) : (
                  `₦${Math.round(promo.progress?.highest_order_amount || 0).toLocaleString()} highest order`
                )}
              </span>
              <span>₦{promo.order_threshold.toLocaleString()} needed</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            {promo.can_redeem ? (
              <Button
                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                onClick={() => onRedeem(promo)}
                disabled={isRedeeming}
              >
                <Gift className="w-4 h-4 mr-2" />
                {isRedeeming ? 'Claiming...' : 'Claim Free Meal'}
              </Button>
            ) : promo.progress_percent >= 100 ? (
              <Button className="flex-1" disabled variant="secondary">
                Already redeemed this period
              </Button>
            ) : (
              <Button
                variant="outline"
                className="flex-1"
                onClick={onViewVendor}
              >
                <Store className="w-4 h-4 mr-2" />
                Order from {promo.vendor_name}
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
