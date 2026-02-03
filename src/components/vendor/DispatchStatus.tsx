import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Loader2, Search, RefreshCw, AlertCircle, CheckCircle2, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

interface DispatchStatusProps {
  orderId: string;
  orderNumber: string;
  vendorId?: string;
  vendorLat?: number;
  vendorLng?: number;
  onRiderAssigned?: () => void;
  onShowManualAssign?: () => void;
}

interface DispatchRequest {
  id: string;
  status: string;
  priority_tier: string;
  search_radius_km: number;
  retry_count: number;
  max_retries: number;
  expires_at: string;
  created_at: string;
}

export function DispatchStatus({ orderId, orderNumber, vendorId, vendorLat, vendorLng, onRiderAssigned, onShowManualAssign }: DispatchStatusProps) {
  const [dispatch, setDispatch] = useState<DispatchRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [offerCount, setOfferCount] = useState(0);

  useEffect(() => {
    const fetchDispatch = async () => {
      const { data, error } = await supabase
        .from('dispatch_requests')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (!error && data) {
        setDispatch(data as unknown as DispatchRequest);
        
        // Fetch offer count
        const { count } = await supabase
          .from('dispatch_offers')
          .select('*', { count: 'exact', head: true })
          .eq('dispatch_request_id', data.id)
          .eq('status', 'pending');
        
        setOfferCount(count || 0);
      }
      setLoading(false);
    };

    fetchDispatch();

    // Subscribe to dispatch updates
    const channel = supabase
      .channel(`dispatch-${orderId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'dispatch_requests',
          filter: `order_id=eq.${orderId}`,
        },
        (payload) => {
          if (payload.eventType === 'UPDATE' || payload.eventType === 'INSERT') {
            const updated = payload.new as unknown as DispatchRequest;
            setDispatch(updated);
            
            if (updated.status === 'accepted') {
              toast({
                title: '🎉 Rider Found!',
                description: `A rider has accepted order #${orderNumber}`,
              });
              onRiderAssigned?.();
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [orderId, orderNumber, onRiderAssigned]);

  // Update countdown timer - only run when dispatch is pending
  useEffect(() => {
    // Stop timer if dispatch doesn't exist or is no longer pending
    if (!dispatch || dispatch.status !== 'pending') {
      setTimeLeft(null);
      return;
    }

    const updateTimer = () => {
      const expiresAt = new Date(dispatch.expires_at).getTime();
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
      setTimeLeft(remaining);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    
    // Cleanup interval on unmount or when dispatch status changes
    return () => clearInterval(interval);
  }, [dispatch, dispatch?.status]);

  const handleRetryDispatch = async () => {
    setRetrying(true);
    try {
      const response = await supabase.functions.invoke('dispatch-order', {
        body: { orderId },
      });

      if (response.error) {
        throw new Error(response.error.message);
      }

      // Short delay to allow DB to update
      await new Promise(resolve => setTimeout(resolve, 500));

      // Refetch the dispatch data to get the new expires_at and restart countdown
      const { data: newDispatch } = await supabase
        .from('dispatch_requests')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (newDispatch) {
        setDispatch(newDispatch as unknown as DispatchRequest);
        
        // Immediately recalculate time left with new expires_at
        const expiresAt = new Date(newDispatch.expires_at).getTime();
        const now = Date.now();
        const remaining = Math.max(0, Math.floor((expiresAt - now) / 1000));
        setTimeLeft(remaining);
        
        // Fetch new offer count for the NEW dispatch request
        const { count } = await supabase
          .from('dispatch_offers')
          .select('*', { count: 'exact', head: true })
          .eq('dispatch_request_id', newDispatch.id)
          .eq('status', 'pending');
        
        setOfferCount(count || 0);
      }

      toast({
        title: 'Dispatch Restarted',
        description: `Searching for ${response.data?.eligibleRiderCount || 0} available riders`,
      });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to restart dispatch',
        variant: 'destructive',
      });
    } finally {
      setRetrying(false);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getTierLabel = (tier: string) => {
    switch (tier) {
      case 'vendor_riders': return 'Your Riders';
      case 'delivery_company_riders': return 'Delivery Companies';
      case 'platform_riders': return 'Platform Riders';
      default: return tier;
    }
  };

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading dispatch status...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!dispatch) {
    return null;
  }

  // Status: Accepted
  if (dispatch.status === 'accepted') {
    return (
      <Card className="border-green-500 bg-green-50 dark:bg-green-950/20">
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            <span className="font-medium">Rider assigned!</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Status: No riders / Expired
  if (dispatch.status === 'no_riders' || dispatch.status === 'expired') {
    return (
      <Card className="border-orange-500 bg-orange-50 dark:bg-orange-950/20">
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">No platform riders available</p>
                <p className="text-sm text-muted-foreground">
                  Searched within {dispatch.search_radius_km}km
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRetryDispatch}
              disabled={retrying}
            >
              {retrying ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Retry
            </Button>
          </div>
          
          {/* Manual assignment option */}
          {onShowManualAssign && (
            <div className="pt-2 border-t border-orange-200 dark:border-orange-800">
              <p className="text-xs text-muted-foreground mb-2">
                Your affiliated riders might be available:
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={onShowManualAssign}
                className="w-full"
              >
                <Users className="h-4 w-4 mr-2" />
                Assign Your Rider Manually
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Status: Pending (searching) - check if countdown expired
  const isExpired = timeLeft !== null && timeLeft <= 0;

  if (isExpired) {
    return (
      <Card className="border-orange-500 bg-orange-50 dark:bg-orange-950/20">
        <CardContent className="py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-orange-700 dark:text-orange-400">
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">Search timed out</p>
                <p className="text-sm text-muted-foreground">
                  {offerCount > 0 ? `${offerCount} riders notified, none accepted` : 'No riders responded in time'}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={handleRetryDispatch}
              disabled={retrying}
            >
              {retrying ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Search Again
            </Button>
          </div>
          
          {/* Manual assignment option */}
          {onShowManualAssign && (
            <div className="pt-2 border-t border-orange-200 dark:border-orange-800">
              <p className="text-xs text-muted-foreground mb-2">
                Your affiliated riders might be available:
              </p>
              <Button
                size="sm"
                variant="secondary"
                onClick={onShowManualAssign}
                className="w-full"
              >
                <Users className="h-4 w-4 mr-2" />
                Assign Your Rider Manually
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // Status: Pending (actively searching)
  return (
    <Card className="border-primary/50 bg-primary/5">
      <CardContent className="py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search className="h-5 w-5 text-primary" />
              <span className="absolute -top-1 -right-1 h-2 w-2 bg-primary rounded-full animate-ping" />
            </div>
            <div>
              <p className="font-medium">Searching for riders...</p>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Checking {getTierLabel(dispatch.priority_tier)}</span>
                {offerCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {offerCount} notified
                  </Badge>
                )}
              </div>
            </div>
          </div>
          
          {timeLeft !== null && timeLeft > 0 && (
            <Badge variant="outline" className="tabular-nums">
              {formatTime(timeLeft)}
            </Badge>
          )}
        </div>
        
        {dispatch.retry_count > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            Retry {dispatch.retry_count}/{dispatch.max_retries} • Radius: {dispatch.search_radius_km}km
          </p>
        )}
      </CardContent>
    </Card>
  );
}
