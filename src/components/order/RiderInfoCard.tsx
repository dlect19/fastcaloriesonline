import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Bike, Phone, Star, Car } from 'lucide-react';

interface RiderInfoCardProps {
  riderId: string;
}

interface RiderDetails {
  name: string;
  phone: string | null;
  rating: number;
  totalDeliveries: number;
  avatarUrl: string | null;
  vehicleType: string | null;
  vehiclePlate: string | null;
}

export function RiderInfoCard({ riderId }: RiderInfoCardProps) {
  const [riderDetails, setRiderDetails] = useState<RiderDetails | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (riderId) {
      fetchRiderDetails();
    }
  }, [riderId]);

  const fetchRiderDetails = async () => {
    try {
      const { data: riderProfile } = await supabase
        .from('rider_profiles')
        .select('rating, total_deliveries, user_id, vehicle_type, vehicle_plate')
        .eq('user_id', riderId)
        .maybeSingle();

      if (!riderProfile) {
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone, avatar_url')
        .eq('user_id', riderId)
        .maybeSingle();

      setRiderDetails({
        name: profile?.full_name || 'Your Rider',
        phone: profile?.phone || null,
        rating: riderProfile.rating || 0,
        totalDeliveries: riderProfile.total_deliveries || 0,
        avatarUrl: profile?.avatar_url || null,
        vehicleType: riderProfile.vehicle_type || null,
        vehiclePlate: riderProfile.vehicle_plate || null,
      });
    } catch (error) {
      console.error('Error fetching rider details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !riderDetails) return null;

  const vehicleEmoji = riderDetails.vehicleType === 'bicycle' ? '🚲' :
    riderDetails.vehicleType === 'car' ? '🚗' : '🏍️';

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Bike className="w-5 h-5 text-primary" />
          Your Delivery Rider
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-3">
          <Avatar className="w-14 h-14 border-2 border-primary/30">
            <AvatarImage src={riderDetails.avatarUrl || undefined} alt={riderDetails.name} />
            <AvatarFallback className="bg-primary/10 text-primary text-lg font-bold">
              {riderDetails.name.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-semibold text-foreground text-lg">{riderDetails.name}</p>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-0.5">
              <span className="flex items-center gap-1">
                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                {riderDetails.rating.toFixed(1)}
              </span>
              <span>•</span>
              <span>{riderDetails.totalDeliveries} deliveries</span>
            </div>
          </div>
        </div>

        {/* Vehicle info */}
        {(riderDetails.vehicleType || riderDetails.vehiclePlate) && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-background/60 text-sm">
            <Car className="w-4 h-4 text-muted-foreground" />
            <span className="text-muted-foreground">
              {vehicleEmoji} {riderDetails.vehicleType && <span className="capitalize">{riderDetails.vehicleType}</span>}
              {riderDetails.vehiclePlate && <span className="font-mono ml-2 text-foreground">{riderDetails.vehiclePlate}</span>}
            </span>
          </div>
        )}
        
        {riderDetails.phone && (
          <a 
            href={`tel:${riderDetails.phone}`}
            className="flex items-center gap-2 w-full p-3 rounded-lg bg-calorie-low text-white hover:bg-calorie-low/90 transition-colors justify-center font-medium"
          >
            <Phone className="w-4 h-4" />
            Call Rider: {riderDetails.phone}
          </a>
        )}
      </CardContent>
    </Card>
  );
}
