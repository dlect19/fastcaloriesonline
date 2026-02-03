import { useState, useEffect } from 'react';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, Navigation, Clock, Banknote, Store, User, Timer } from 'lucide-react';

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

  const isExpired = timeLeft <= 0;
  const isUrgent = timeLeft <= 15 && timeLeft > 0;

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
      </CardHeader>
      
      <CardContent className="space-y-3">
        {/* Pickup Location */}
        <div className="flex items-start gap-2 text-sm">
          <MapPin className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-muted-foreground text-xs">Pickup from</p>
            <p className="font-medium">{offer.vendor_address || 'Vendor location'}</p>
          </div>
        </div>

        {/* Delivery Location */}
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
