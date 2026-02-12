import { useState, useEffect } from 'react';
import { Bike, Circle, Star, Package, TrendingUp, ChevronDown, ChevronUp, AlertCircle, CheckCircle2, Phone, Mail, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

interface VendorRider {
  id: string;
  rider_profile_id: string;
  is_active: boolean;
  created_at: string;
  rider_profile: {
    id: string;
    is_online: boolean;
    is_verified: boolean;
    rating: number | null;
    total_deliveries: number | null;
    vehicle_type: string | null;
    user_id: string;
    preferred_city: string | null;
    preferred_state: string | null;
    email: string | null;
  };
  user_name?: string;
  user_phone?: string | null;
  user_email?: string | null;
}

interface VendorRiderCardProps {
  rider: VendorRider;
  vendorId: string;
  onToggleStatus: (riderId: string, currentStatus: boolean) => void;
  dateRange?: { from?: Date; to?: Date };
}

interface RiderStats {
  totalDeliveries: number;
  completedDeliveries: number;
  totalEarnings: number;
}

export function VendorRiderCard({ rider, vendorId, onToggleStatus, dateRange }: VendorRiderCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [stats, setStats] = useState<RiderStats | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  const fetchRiderStats = async () => {
    if (!rider.rider_profile?.user_id) return;
    
    setLoadingStats(true);
    try {
      let query = supabase
        .from('orders')
        .select('id, delivery_fee, status')
        .eq('vendor_id', vendorId)
        .eq('rider_id', rider.rider_profile.user_id);

      if (dateRange?.from) {
        query = query.gte('delivered_at', dateRange.from.toISOString());
      }
      if (dateRange?.to) {
        const endOfDay = new Date(dateRange.to);
        endOfDay.setHours(23, 59, 59, 999);
        query = query.lte('delivered_at', endOfDay.toISOString());
      }

      const { data: orders } = await query;

      if (orders) {
        const completedOrders = orders.filter(o => o.status === 'delivered');
        // 80% goes to vendor for affiliated riders
        const vendorDeliveryRevenue = completedOrders.reduce((sum, o) => sum + (o.delivery_fee || 0) * 0.8, 0);
        
        setStats({
          totalDeliveries: orders.length,
          completedDeliveries: completedOrders.length,
          totalEarnings: Math.round(vendorDeliveryRevenue),
        });
      }
    } catch (error) {
      console.error('Error fetching rider stats:', error);
    } finally {
      setLoadingStats(false);
    }
  };

  useEffect(() => {
    if (expanded) {
      fetchRiderStats();
    }
  }, [expanded, dateRange?.from?.getTime(), dateRange?.to?.getTime()]);

  const isVerified = rider.rider_profile?.is_verified;
  const isOnline = rider.rider_profile?.is_online && rider.is_active;

  return (
    <div className="p-4 bg-muted/30 rounded-xl space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center relative">
            <Bike className="w-6 h-6 text-primary" />
            {isOnline && (
              <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-success border-2 border-background" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">{rider.user_name}</span>
              {!isVerified && (
              <Badge variant="outline" className="text-xs bg-warning/10 text-warning border-warning/30">
                <AlertCircle className="w-3 h-3 mr-1" />
                Pending Admin Approval
              </Badge>
            )}
            {isVerified && (
              <Badge variant="outline" className="text-xs bg-success/10 text-success border-success/30">
                <CheckCircle2 className="w-3 h-3 mr-1" />
                Verified
              </Badge>
              )}
            </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
            <span>{rider.rider_profile?.vehicle_type || 'Vehicle not set'}</span>
            <span>•</span>
            <span>{rider.rider_profile?.total_deliveries || 0} total trips</span>
            {rider.rider_profile?.rating && (
              <>
                <span>•</span>
                <span className="flex items-center gap-0.5">
                  <Star className="w-3 h-3 fill-warning text-warning" />
                  {rider.rider_profile.rating.toFixed(1)}
                </span>
              </>
            )}
          </div>
          
          {/* Contact Details */}
          <div className="flex flex-wrap items-center gap-3 mt-2 text-sm">
            {rider.user_phone && (
              <a 
                href={`tel:${rider.user_phone}`} 
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <Phone className="w-3.5 h-3.5" />
                {rider.user_phone}
              </a>
            )}
            {rider.user_email && (
              <a 
                href={`mailto:${rider.user_email}`} 
                className="flex items-center gap-1 text-primary hover:underline"
              >
                <Mail className="w-3.5 h-3.5" />
                {rider.user_email}
              </a>
            )}
            {(rider.rider_profile?.preferred_city || rider.rider_profile?.preferred_state) && (
              <span className="flex items-center gap-1 text-muted-foreground">
                <MapPin className="w-3.5 h-3.5" />
                {[rider.rider_profile?.preferred_city, rider.rider_profile?.preferred_state]
                  .filter(Boolean)
                  .join(', ')}
              </span>
            )}
          </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={rider.is_active ? 'default' : 'secondary'}>
            {rider.is_active ? 'Active' : 'Inactive'}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onToggleStatus(rider.id, rider.is_active)}
          >
            {rider.is_active ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      </div>

      {/* Warning for unverified riders */}
      {!isVerified && (
        <div className="flex items-center gap-2 p-3 bg-warning/10 rounded-lg text-sm">
          <AlertCircle className="w-4 h-4 text-warning flex-shrink-0" />
          <span className="text-warning">
            This rider is waiting for admin verification. They won't be able to receive platform orders until approved.
          </span>
        </div>
      )}

      {/* Expandable stats section */}
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-between text-muted-foreground hover:text-foreground"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Performance Stats
        </span>
        {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </Button>

      {expanded && (
        <div className="grid grid-cols-3 gap-3 pt-2">
          {loadingStats ? (
            <>
              <div className="h-16 bg-muted animate-pulse rounded-lg" />
              <div className="h-16 bg-muted animate-pulse rounded-lg" />
              <div className="h-16 bg-muted animate-pulse rounded-lg" />
            </>
          ) : (
            <>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <Package className="w-5 h-5 mx-auto text-primary mb-1" />
                <p className="text-lg font-bold">{stats?.totalDeliveries || 0}</p>
                <p className="text-xs text-muted-foreground">Orders Assigned</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <CheckCircle2 className="w-5 h-5 mx-auto text-success mb-1" />
                <p className="text-lg font-bold">{stats?.completedDeliveries || 0}</p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-center">
                <TrendingUp className="w-5 h-5 mx-auto text-accent mb-1" />
                <p className="text-lg font-bold">₦{(stats?.totalEarnings || 0).toLocaleString()}</p>
                <p className="text-xs text-muted-foreground">Your Revenue</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
