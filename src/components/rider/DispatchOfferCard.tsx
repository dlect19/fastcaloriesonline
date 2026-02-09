import { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { MapPin, Navigation, Clock, Banknote, Store, User, Timer, CloudRain, Sun, CloudLightning, TrendingUp, Shield } from 'lucide-react';

interface DispatchOfferCardProps {
  offer: {
    id: string;
    distance_km: number;
    delivery_fee: number;
    rider_share: number;
    vendor_name: string | null;
    vendor_address: string | null;
    customer_address: string | null;
    estimated_pickup_minutes: number | null;
    estimated_delivery_minutes: number | null;
    priority_tier: string;
    expires_at: string;
    platform_fee?: number;
    distance_bonus?: number;
    time_surge_bonus?: number;
    weather_surge_bonus?: number;
    total_surge_bonus?: number;
    subsidy_amount?: number;
    weather_condition?: string;
    time_period?: string;
  };
  onAccept: (offerId: string) => Promise<{ success: boolean }>;
  onDecline: (offerId: string) => Promise<{ success: boolean }>;
  accepting: boolean;
  declining: boolean;
}

export function DispatchOfferCard({
  offer,
  onAccept,
  onDecline,
  accepting,
  declining,
}: DispatchOfferCardProps) {
  const [timeLeft, setTimeLeft] = useState<number>(0);

  useEffect(() => {
    const updateTimeLeft = () => {
      const expiresAt = new Date(offer.expires_at).getTime();
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
      setTimeLeft(remaining);
    };

    updateTimeLeft();
    const interval = setInterval(updateTimeLeft, 1000);
    return () => clearInterval(interval);
  }, [offer.expires_at]);

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTierLabel = (tier: string) => {
    switch (tier) {
      case 'vendor_riders': return 'Vendor Priority';
      case 'delivery_company_riders': return 'Company';
      case 'platform_riders': return 'Platform';
      default: return tier;
    }
  };

  const getWeatherIcon = (condition: string) => {
    switch (condition) {
      case 'rain': return <CloudRain className="h-3 w-3" />;
      case 'storm': return <CloudLightning className="h-3 w-3" />;
      default: return <Sun className="h-3 w-3" />;
    }
  };

  const getTimePeriodLabel = (period: string) => {
    switch (period) {
      case 'morning': return '🌅 Morning';
      case 'afternoon': return '☀️ Afternoon';
      case 'night': return '🌙 Night';
      default: return period;
    }
  };

  const isExpired = timeLeft <= 0;
  const isUrgent = timeLeft <= 15 && timeLeft > 0;

  const platformFee = offer.platform_fee || 0;
  const distanceBonus = offer.distance_bonus || 0;
  const timeSurge = offer.time_surge_bonus || 0;
  const weatherSurge = offer.weather_surge_bonus || 0;
  const totalSurge = offer.total_surge_bonus || 0;
  const subsidy = offer.subsidy_amount || 0;
  const hasSurge = totalSurge > 0;
  const hasSubsidy = subsidy > 0;

  if (isExpired) {
    return null;
  }

  return (
    <Card className={`border-2 transition-all ${isUrgent ? 'border-destructive animate-pulse' : 'border-primary'}`}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Store className="h-5 w-5 text-primary" />
            {offer.vendor_name || 'Restaurant'}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-xs">
              {getTierLabel(offer.priority_tier)}
            </Badge>
            <Badge
              variant={isUrgent ? 'destructive' : 'secondary'}
              className="flex items-center gap-1 tabular-nums"
            >
              <Timer className="h-3 w-3" />
              {formatTime(timeLeft)}
            </Badge>
          </div>
        </div>
        {/* Surge indicators */}
        {(hasSurge || offer.weather_condition !== 'clear') && (
          <div className="flex items-center gap-2 mt-1">
            {offer.weather_condition && offer.weather_condition !== 'clear' && (
              <Badge variant="outline" className="text-xs bg-blue-500/10 text-blue-600 border-blue-500/30">
                {getWeatherIcon(offer.weather_condition)}
                <span className="ml-1 capitalize">{offer.weather_condition}</span>
              </Badge>
            )}
            {offer.time_period && timeSurge > 0 && (
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/30">
                {getTimePeriodLabel(offer.time_period)}
              </Badge>
            )}
            {hasSurge && (
              <Badge variant="outline" className="text-xs bg-green-500/10 text-green-600 border-green-500/30">
                <TrendingUp className="h-3 w-3 mr-1" />
                +₦{totalSurge.toLocaleString()} surge
              </Badge>
            )}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Pickup & Delivery Locations */}
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-muted-foreground text-xs">Pickup from</p>
            <p className="font-medium">{offer.vendor_address || 'Vendor location'}</p>
          </div>
        </div>

        <div className="flex items-start gap-2 text-sm">
          <User className="h-4 w-4 text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-muted-foreground text-xs">Deliver to</p>
            <p className="font-medium">{offer.customer_address || 'Customer location'}</p>
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-3 gap-2 pt-2">
          <div className="bg-muted/50 rounded-lg p-2 text-center">
            <Navigation className="h-4 w-4 mx-auto text-muted-foreground" />
            <p className="text-xs text-muted-foreground mt-1">Distance</p>
            <p className="font-semibold text-sm">{offer.distance_km.toFixed(1)} km</p>
          </div>

          <div className="bg-muted/50 rounded-lg p-2 text-center">
            <Clock className="h-4 w-4 mx-auto text-muted-foreground" />
            <p className="text-xs text-muted-foreground mt-1">Est. Time</p>
            <p className="font-semibold text-sm">
              {offer.estimated_pickup_minutes || Math.ceil((offer.distance_km / 25) * 60)} min
            </p>
          </div>

          <div className="bg-primary/10 rounded-lg p-2 text-center">
            <Banknote className="h-4 w-4 mx-auto text-primary" />
            <p className="text-xs text-muted-foreground mt-1">You Earn</p>
            <p className="font-bold text-sm text-primary">₦{offer.rider_share.toLocaleString()}</p>
          </div>
        </div>

        {/* Transparent Payout Breakdown */}
        <Separator />
        <div className="space-y-1.5 text-sm">
          <p className="font-medium text-xs text-muted-foreground uppercase tracking-wide">Payout Breakdown</p>

          <div className="flex justify-between">
            <span className="text-muted-foreground">Delivery fee</span>
            <span>₦{offer.delivery_fee.toLocaleString()}</span>
          </div>

          <div className="flex justify-between text-destructive/80">
            <span>Platform fee</span>
            <span>-₦{platformFee.toLocaleString()}</span>
          </div>

          {distanceBonus > 0 && (
            <div className="flex justify-between text-green-600">
              <span>Distance bonus ({'>'}4km)</span>
              <span>+₦{distanceBonus.toLocaleString()}</span>
            </div>
          )}

          {timeSurge > 0 && (
            <div className="flex justify-between text-amber-600">
              <span>{getTimePeriodLabel(offer.time_period || 'morning')} surge</span>
              <span>+₦{timeSurge.toLocaleString()}</span>
            </div>
          )}

          {weatherSurge > 0 && (
            <div className="flex justify-between text-blue-600">
              <span className="flex items-center gap-1">
                {getWeatherIcon(offer.weather_condition || 'clear')}
                Weather surge
              </span>
              <span>+₦{weatherSurge.toLocaleString()}</span>
            </div>
          )}

          {hasSubsidy && (
            <div className="flex justify-between text-purple-600">
              <span className="flex items-center gap-1">
                <Shield className="h-3 w-3" />
                Guaranteed min top-up
              </span>
              <span>+₦{subsidy.toLocaleString()}</span>
            </div>
          )}

          <Separator className="my-1" />
          <div className="flex justify-between font-bold text-primary">
            <span>Your payout</span>
            <span>₦{offer.rider_share.toLocaleString()}</span>
          </div>
        </div>

        {/* Rider trust message */}
        <p className="text-[11px] text-muted-foreground text-center italic pt-1">
          You see the full delivery fee. We take a small capped platform fee, and you're guaranteed a minimum payout on every trip.
        </p>
      </CardContent>

      <CardFooter className="gap-2">
        <Button
          variant="outline"
          className="flex-1"
          onClick={() => onDecline(offer.id)}
          disabled={declining || accepting}
        >
          {declining ? 'Declining...' : 'Decline'}
        </Button>
        <Button
          className="flex-1"
          onClick={() => onAccept(offer.id)}
          disabled={accepting || declining}
        >
          {accepting ? 'Accepting...' : 'Accept Delivery'}
        </Button>
      </CardFooter>
    </Card>
  );
}
