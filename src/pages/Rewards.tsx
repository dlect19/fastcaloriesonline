import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SpinWheel } from '@/components/spin/SpinWheel';
import { useSpinWheel } from '@/hooks/useSpinWheel';
import { usePlatformPromos } from '@/hooks/usePlatformPromos';
import { usePlatformSettings } from '@/hooks/usePlatformSettings';
import { useAuth } from '@/hooks/useAuth';
import { Gift, Sparkles, Clock, ArrowLeft, Trophy, Star, Percent, Wallet } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function Rewards() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeDiscounts, canFreeSpin, hasTryAgain, spinEnabled } = useSpinWheel();
  const { eligibility, settings: promoSettings } = usePlatformPromos();
  const { settings } = usePlatformSettings();
  const [activeTab, setActiveTab] = useState('free');

  // Get spins per tier from settings
  const tier1Spins = parseInt(settings?.spin_tier1_spins || '1');
  const tier2Spins = parseInt(settings?.spin_tier2_spins || '3');
  const tier3Spins = parseInt(settings?.spin_tier3_spins || '6');
  const segmentDiscounts = settings?.spin_segment_discounts || '0,2,5,8,10';

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <Gift className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-xl font-bold mb-2">Login to Access Rewards</h2>
            <p className="text-muted-foreground mb-4">
              Spin the wheel and win discounts on your orders!
            </p>
            <Button onClick={() => navigate('/auth')}>
              Login Now
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="bg-gradient-to-br from-primary/20 to-primary/5 px-4 pt-12 pb-8">
        <div className="max-w-lg mx-auto">
          <Button
            variant="ghost"
            size="icon"
            className="mb-4"
            onClick={() => navigate(-1)}
          >
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Trophy className="w-7 h-7 text-primary" />
            Rewards Center
          </h1>
          <p className="text-muted-foreground mt-1">
            Spin the wheel and win amazing discounts!
          </p>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 -mt-4 space-y-6">
        {/* Active Discounts */}
        {activeDiscounts.length > 0 && (
          <Card className="border-primary/20 bg-primary/5">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" />
                Your Active Discounts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {activeDiscounts.map((discount) => (
                <div
                  key={discount.id}
                  className="flex items-center justify-between p-3 bg-background rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
                      <Percent className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-bold text-foreground">
                        {discount.discount_percentage}% OFF
                      </p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        Expires {formatDistanceToNow(new Date(discount.expires_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="capitalize">
                    {discount.wheel_type}
                  </Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Platform Promos Info */}
        {(eligibility.firstOrderDiscount || eligibility.loyaltyDiscount) && (
          <Card className="border-accent/20 bg-accent/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Star className="w-8 h-8 text-accent" />
                <div>
                  {eligibility.firstOrderDiscount && (
                    <p className="font-medium text-foreground">
                      🎉 First Order: {eligibility.firstOrderDiscount}% OFF
                    </p>
                  )}
                  {eligibility.loyaltyDiscount && (
                    <p className="font-medium text-foreground">
                      🏆 Loyalty Reward: {eligibility.loyaltyDiscount}% OFF
                    </p>
                  )}
                  {eligibility.nextLoyaltyAt && eligibility.nextLoyaltyAt > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {eligibility.nextLoyaltyAt} order(s) until next loyalty reward
                    </p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Spin Wheels */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5" />
              Spin & Win
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="w-full grid grid-cols-4 mb-6">
                <TabsTrigger value="free" className="relative text-xs sm:text-sm">
                  Free
                  {canFreeSpin && (
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-primary rounded-full" />
                  )}
                </TabsTrigger>
                <TabsTrigger value="tier1" className="text-xs sm:text-sm">₦100 ({tier1Spins})</TabsTrigger>
                <TabsTrigger value="tier2" className="text-xs sm:text-sm">₦200 ({tier2Spins})</TabsTrigger>
                <TabsTrigger value="tier3" className="text-xs sm:text-sm">₦500 ({tier3Spins})</TabsTrigger>
              </TabsList>

              <TabsContent value="free" className="mt-0">
                {spinEnabled.free ? (
                  <SpinWheel wheelType="free" />
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Free spins are currently disabled
                  </div>
                )}
              </TabsContent>

              <TabsContent value="tier1" className="mt-0">
                {spinEnabled.paid ? (
                  <SpinWheel wheelType="tier1" />
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Paid spins are currently disabled
                  </div>
                )}
              </TabsContent>

              <TabsContent value="tier2" className="mt-0">
                {spinEnabled.paid ? (
                  <SpinWheel wheelType="tier2" />
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Paid spins are currently disabled
                  </div>
                )}
              </TabsContent>

              <TabsContent value="tier3" className="mt-0">
                {spinEnabled.paid ? (
                  <SpinWheel wheelType="tier3" />
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    Paid spins are currently disabled
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* How it works */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">How it Works</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">1</div>
              <p>Get one <strong>free spin</strong> every day. If you land on "Try Again", you get one bonus spin!</p>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">2</div>
              <p>Purchase spin packs: <strong>Bronze (₦100) = {tier1Spins} spin{tier1Spins > 1 ? 's' : ''}</strong>, <strong>Silver (₦200) = {tier2Spins} spins</strong>, <strong>Gold (₦500) = {tier3Spins} spins</strong>.</p>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">3</div>
              <p>All wheels have the same segments: <strong>{segmentDiscounts}%, Try Again</strong>.</p>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">4</div>
              <p>Discounts are valid for <strong>24 hours</strong> and can only be used with <strong>wallet payment</strong>.</p>
            </div>
            <div className="flex gap-3">
              <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">5</div>
              <p>Only <strong>one discount</strong> can be used per order (no stacking).</p>
            </div>
          </CardContent>
        </Card>

        {/* Fund Wallet CTA */}
        <Card className="bg-gradient-to-br from-primary/10 to-accent/10 border-0">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Wallet className="w-8 h-8 text-primary" />
              <div>
                <p className="font-medium text-foreground">Need more spins?</p>
                <p className="text-sm text-muted-foreground">Fund your wallet for paid wheels</p>
              </div>
            </div>
            <Button size="sm" onClick={() => navigate('/profile/wallet')}>
              Fund Wallet
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
