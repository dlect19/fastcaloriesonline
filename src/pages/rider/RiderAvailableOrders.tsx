import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { RiderLayout } from '@/components/rider/RiderLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SoundEnableBanner } from '@/components/shared/SoundEnableBanner';
import { DispatchOfferCard } from '@/components/rider/DispatchOfferCard';
import { Package, MapPin, Loader2, Navigation, RefreshCw, Lock, Bell } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useRepeatingNotificationSound } from '@/hooks/useRepeatingNotificationSound';
import { useRiderRestrictions } from '@/hooks/useRiderRestrictions';
import { useDispatchOffers } from '@/hooks/useDispatchOffers';
import { format } from 'date-fns';

export default function RiderAvailableOrders() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const [riderProfile, setRiderProfile] = useState<any>(null);
  const [affiliatedVendorName, setAffiliatedVendorName] = useState<string | null>(null);

  // Use dispatch offers hook for new dispatch system
  const { 
    offers, 
    loading: offersLoading, 
    accepting, 
    declining, 
    acceptOffer, 
    declineOffer,
    refetch: refetchOffers,
    pendingCount 
  } = useDispatchOffers();

  // Use rider restrictions hook
  const { isAffiliated, affiliatedVendorId, canViewEarnings } = useRiderRestrictions(riderProfile);

  // Notification sound hook
  const { 
    playOnce, 
    startRepeating, 
    stopRepeating, 
    soundEnabled, 
    isBlocked, 
    setSoundEnabled, 
    unlock 
  } = useRepeatingNotificationSound({ 
    intervalMs: 10000, 
    storageKey: 'rider-available-orders-sound' 
  });

  useEffect(() => {
    checkAuth();
  }, []);

  // Start notification sound when there are pending offers
  useEffect(() => {
    if (pendingCount > 0 && isOnline && !loading) {
      startRepeating();
    } else {
      stopRepeating();
    }
  }, [pendingCount, isOnline, loading]);

  // Fetch affiliated vendor name
  useEffect(() => {
    if (affiliatedVendorId) {
      fetchVendorName(affiliatedVendorId);
    }
  }, [affiliatedVendorId]);

  const fetchVendorName = async (vendorId: string) => {
    const { data } = await supabase
      .from('vendors')
      .select('name')
      .eq('id', vendorId)
      .single();
    if (data) setAffiliatedVendorName(data.name);
  };

  const checkAuth = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      navigate('/rider/auth');
      return;
    }

    const { data: profile } = await supabase
      .from('rider_profiles')
      .select('*')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile) {
      navigate('/rider/auth');
      return;
    }

    setRiderProfile(profile);
    setIsOnline(profile.is_online || false);
    setLoading(false);
  };

  const handleRefresh = () => {
    setRefreshing(true);
    refetchOffers().finally(() => setRefreshing(false));
  };

  const handleAcceptOffer = async (offerId: string) => {
    const result = await acceptOffer(offerId);
    if (result.success) {
      stopRepeating();
      navigate('/rider/orders');
    }
    return result;
  };

  const handleDeclineOffer = async (offerId: string) => {
    const result = await declineOffer(offerId);
    return result;
  };

  const toggleOnline = async (online: boolean) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from('rider_profiles')
      .update({ is_online: online })
      .eq('user_id', user.id);

    setIsOnline(online);
    
    // Stop notification sound when going offline
    if (!online) {
      stopRepeating();
    }
    
    toast({
      title: online ? 'You are now online' : 'You are now offline',
    });
  };

  const handleTestSound = () => {
    playOnce();
    toast({ title: '🔔 Sound test', description: 'Did you hear it?' });
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const hasLocation = riderProfile?.preferred_latitude || riderProfile?.current_latitude;

  return (
    <RiderLayout isOnline={isOnline} onToggleOnline={toggleOnline}>
      <div className="mb-6 md:mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground">Delivery Requests</h1>
          <p className="text-muted-foreground text-sm md:text-base">
            {isAffiliated && affiliatedVendorName ? (
              <span className="flex items-center gap-1">
                <Lock className="w-3 h-3" />
                Orders from {affiliatedVendorName} only
              </span>
            ) : (
              `Accept deliveries within your work area`
            )}
          </p>
        </div>
        <Button 
          variant="outline" 
          size="icon" 
          onClick={handleRefresh}
          disabled={refreshing}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {/* Affiliated Rider Notice */}
      {isAffiliated && (
        <Card className="mb-4 border-primary/30 bg-primary/5">
          <CardContent className="p-4">
            <p className="text-sm text-primary font-medium flex items-center gap-2">
              <Lock className="w-4 h-4" />
              You're a dedicated rider for {affiliatedVendorName}. You'll only see orders from this vendor.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Sound Enable Banner */}
      {isOnline && hasLocation && (
        <SoundEnableBanner
          soundEnabled={soundEnabled}
          isBlocked={isBlocked}
          onToggleSound={setSoundEnabled}
          onUnlock={unlock}
          onTestSound={handleTestSound}
          className="mb-4"
        />
      )}

      {!hasLocation ? (
        <Card>
          <CardContent className="p-6 md:p-8 text-center">
            <Navigation className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="font-medium mb-2">Location not set</p>
            <p className="text-muted-foreground text-sm mb-4">
              Please set your work location in settings to receive delivery requests.
            </p>
            <Button onClick={() => navigate('/rider/settings')}>
              Go to Settings
            </Button>
          </CardContent>
        </Card>
      ) : !isOnline ? (
        <Card>
          <CardContent className="p-6 md:p-8 text-center">
            <Package className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="font-medium mb-2">You're offline</p>
            <p className="text-muted-foreground text-sm mb-4">
              Go online to receive delivery requests from nearby restaurants.
            </p>
            <Button onClick={() => toggleOnline(true)}>
              Go Online
            </Button>
          </CardContent>
        </Card>
      ) : offersLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : offers.length === 0 ? (
        <Card>
          <CardContent className="p-6 md:p-8 text-center">
            <Bell className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="font-medium mb-2">No delivery requests</p>
            <p className="text-muted-foreground text-sm">
              {isAffiliated 
                ? `Waiting for orders from ${affiliatedVendorName}` 
                : 'Waiting for nearby delivery requests'}
            </p>
            <p className="text-xs text-muted-foreground mt-3">
              You'll be notified when a restaurant needs a rider
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {/* Pending Offers Counter */}
          <div className="flex items-center justify-between px-1">
            <Badge variant="secondary" className="gap-1">
              <Bell className="w-3 h-3" />
              {offers.length} active request{offers.length !== 1 ? 's' : ''}
            </Badge>
            <p className="text-xs text-muted-foreground">
              Accept quickly - requests expire!
            </p>
          </div>

          {/* Dispatch Offer Cards */}
          {offers.map((offer) => (
            <DispatchOfferCard
              key={offer.id}
              offer={offer}
              onAccept={handleAcceptOffer}
              onDecline={handleDeclineOffer}
              accepting={accepting === offer.id}
              declining={declining === offer.id}
            />
          ))}
        </div>
      )}
    </RiderLayout>
  );
}
