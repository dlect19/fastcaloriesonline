import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Bike, Phone, Star } from 'lucide-react';

interface RiderInfoCardProps {
  riderId: string;
}

interface RiderDetails {
  name: string;
  phone: string | null;
  rating: number;
  totalDeliveries: number;
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
      // Get rider profile
      const { data: riderProfile } = await supabase
        .from('rider_profiles')
        .select('rating, total_deliveries, user_id')
        .eq('user_id', riderId)
        .maybeSingle();

      if (!riderProfile) {
        setLoading(false);
        return;
      }

      // Get user profile for name and phone
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('user_id', riderId)
        .maybeSingle();

      setRiderDetails({
        name: profile?.full_name || 'Your Rider',
        phone: profile?.phone || null,
        rating: riderProfile.rating || 0,
        totalDeliveries: riderProfile.total_deliveries || 0
      });
    } catch (error) {
      console.error('Error fetching rider details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !riderDetails) return null;

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <Bike className="w-5 h-5 text-primary" />
          Your Delivery Rider
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-semibold text-foreground text-lg">{riderDetails.name}</p>
            <div className="flex items-center gap-3 text-sm text-muted-foreground mt-1">
              <span className="flex items-center gap-1">
                <Star className="w-4 h-4 fill-yellow-400 text-yellow-400" />
                {riderDetails.rating.toFixed(1)}
              </span>
              <span>•</span>
              <span>{riderDetails.totalDeliveries} deliveries</span>
            </div>
          </div>
        </div>
        
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
