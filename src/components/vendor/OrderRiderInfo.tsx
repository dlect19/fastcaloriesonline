import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Bike, Phone, Star } from 'lucide-react';

interface OrderRiderInfoProps {
  riderId: string | null;
  orderStatus: string;
}

interface RiderInfo {
  name: string;
  phone: string | null;
  rating: number;
  totalDeliveries: number;
}

export function OrderRiderInfo({ riderId, orderStatus }: OrderRiderInfoProps) {
  const [riderInfo, setRiderInfo] = useState<RiderInfo | null>(null);

  useEffect(() => {
    if (riderId) {
      fetchRiderInfo();
    }
  }, [riderId]);

  const fetchRiderInfo = async () => {
    try {
      // Get rider profile
      const { data: riderProfile } = await supabase
        .from('rider_profiles')
        .select('rating, total_deliveries, user_id')
        .eq('user_id', riderId)
        .maybeSingle();

      if (!riderProfile) return;

      // Get user profile for name and phone
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('user_id', riderId)
        .maybeSingle();

      const { data: deliveredCount } = await supabase
        .rpc('get_rider_delivery_count', { _rider_id: riderId });

      setRiderInfo({
        name: profile?.full_name || 'Rider',
        phone: profile?.phone || null,
        rating: riderProfile.rating || 0,
        totalDeliveries: (deliveredCount as number) ?? riderProfile.total_deliveries ?? 0
      });
    } catch (error) {
      console.error('Error fetching rider info:', error);
    }
  };

  if (!riderId || !riderInfo) return null;

  const getStatusLabel = () => {
    switch (orderStatus) {
      case 'ready_for_pickup':
        return 'Assigned';
      case 'picked_up':
        return 'Picked Up';
      case 'on_the_way':
        return 'Delivering';
      case 'delivered':
        return 'Completed';
      default:
        return 'Assigned';
    }
  };

  return (
    <div className="mt-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
            <Bike className="w-4 h-4 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{riderInfo.name}</p>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-0.5">
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                {riderInfo.rating.toFixed(1)}
              </span>
              <span>•</span>
              <span>{riderInfo.totalDeliveries} trips</span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {riderInfo.phone && (
            <a 
              href={`tel:${riderInfo.phone}`} 
              className="p-2 rounded-full bg-primary/10 hover:bg-primary/20 transition-colors"
            >
              <Phone className="w-4 h-4 text-primary" />
            </a>
          )}
          <Badge variant="secondary" className="text-xs">
            {getStatusLabel()}
          </Badge>
        </div>
      </div>
    </div>
  );
}
