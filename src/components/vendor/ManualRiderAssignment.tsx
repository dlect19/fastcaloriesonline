import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Loader2, Users, Globe, MapPin, Star, Bike } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ManualRiderAssignmentProps {
  orderId: string;
  orderNumber: string;
  vendorId: string;
  vendorLat: number;
  vendorLng: number;
  onAssigned: () => void;
}

interface AvailableRider {
  id: string;
  user_id: string;
  profile_name: string;
  rating: number;
  total_deliveries: number;
  distance: number;
  type: 'vendor' | 'company';
}

export function ManualRiderAssignment({ 
  orderId, 
  orderNumber, 
  vendorId, 
  vendorLat, 
  vendorLng, 
  onAssigned 
}: ManualRiderAssignmentProps) {
  const { toast } = useToast();
  const [availableRiders, setAvailableRiders] = useState<AvailableRider[]>([]);
  const [selectedRiderId, setSelectedRiderId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [assigning, setAssigning] = useState(false);
  const [dispatchingPublic, setDispatchingPublic] = useState(false);

  useEffect(() => {
    fetchAvailableRiders();
  }, [vendorId]);

  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const fetchAvailableRiders = async () => {
    setLoading(true);
    try {
      // Get vendor's affiliated riders from vendor_riders table
      const { data: vendorRiders } = await supabase
        .from('vendor_riders')
        .select('rider_profile_id')
        .eq('vendor_id', vendorId)
        .eq('is_active', true);

      const vendorRiderProfileIds = (vendorRiders || []).map(vr => vr.rider_profile_id);

      // Fetch online, verified riders that are vendor or company affiliated
      const { data: riders } = await supabase
        .from('rider_profiles')
        .select('id, user_id, current_latitude, current_longitude, preferred_latitude, preferred_longitude, rating, total_deliveries, affiliated_vendor_id, delivery_company_id')
        .eq('is_online', true)
        .eq('is_verified', true)
        .eq('is_email_verified', true);

      if (!riders || riders.length === 0) {
        setAvailableRiders([]);
        return;
      }

      // Get profiles for names
      const userIds = riders.map(r => r.user_id);
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name')
        .in('user_id', userIds);

      const profileMap = new Map(profiles?.map(p => [p.user_id, p.full_name]) || []);

      // Filter and calculate distances - only vendor and company riders
      const ridersWithDistance = riders
        .filter(rider => {
          const isVendorRider = vendorRiderProfileIds.includes(rider.id) || rider.affiliated_vendor_id === vendorId;
          const isCompanyRider = !!rider.delivery_company_id;
          return isVendorRider || isCompanyRider;
        })
        .map(rider => {
          const riderLat = rider.current_latitude || rider.preferred_latitude;
          const riderLng = rider.current_longitude || rider.preferred_longitude;

          let distance = 999;
          if (riderLat && riderLng && vendorLat && vendorLng) {
            distance = calculateDistance(vendorLat, vendorLng, riderLat, riderLng);
          }

          const isVendorRider = vendorRiderProfileIds.includes(rider.id) || rider.affiliated_vendor_id === vendorId;

          return {
            id: rider.id,
            user_id: rider.user_id,
            profile_name: profileMap.get(rider.user_id) || 'Rider',
            rating: rider.rating || 0,
            total_deliveries: rider.total_deliveries || 0,
            distance,
            type: isVendorRider ? 'vendor' as const : 'company' as const
          };
        })
        .filter(r => r.distance < 30) // Within 30km
        .sort((a, b) => {
          // Vendor riders first, then by distance
          if (a.type === 'vendor' && b.type !== 'vendor') return -1;
          if (a.type !== 'vendor' && b.type === 'vendor') return 1;
          return a.distance - b.distance;
        })
        .slice(0, 15);

      setAvailableRiders(ridersWithDistance);
    } catch (error) {
      console.error('Error fetching riders:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleManualAssign = async () => {
    if (!selectedRiderId) {
      toast({
        title: 'Please select a rider',
        variant: 'destructive'
      });
      return;
    }

    setAssigning(true);
    try {
      const selectedRider = availableRiders.find(r => r.id === selectedRiderId);
      if (!selectedRider) throw new Error('Rider not found');

      // Update order with assigned rider directly
      const { error } = await supabase
        .from('orders')
        .update({
          rider_id: selectedRider.user_id,
          status: 'assigned',
          updated_at: new Date().toISOString(),
        })
        .eq('id', orderId);

      if (error) throw error;

      toast({ title: '✅ Rider assigned successfully' });
      onAssigned();
    } catch (error: any) {
      toast({
        title: 'Error assigning rider',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setAssigning(false);
    }
  };

  const handleDispatchPublic = async () => {
    setDispatchingPublic(true);
    try {
      // Call dispatch-order with public flag
      const { data, error } = await supabase.functions.invoke('dispatch-order', {
        body: { orderId, publicOnly: true }
      });

      if (error) throw error;

      if (data?.eligibleRiderCount > 0) {
        toast({
          title: '🔔 Dispatching to platform riders',
          description: `Notifying ${data.eligibleRiderCount} nearby riders`,
        });
      } else {
        toast({
          title: 'Searching for riders',
          description: 'No platform riders online yet. Will retry automatically.',
          variant: 'destructive',
        });
      }
      onAssigned();
    } catch (error: any) {
      toast({
        title: 'Error dispatching order',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setDispatchingPublic(false);
    }
  };

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4">
          <div className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Loading your riders...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/30 bg-primary/5">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Bike className="w-4 h-4" />
          Assign Rider
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {availableRiders.length > 0 ? (
          <>
            <RadioGroup value={selectedRiderId} onValueChange={setSelectedRiderId}>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {availableRiders.map((rider) => (
                  <div 
                    key={rider.id} 
                    className="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-secondary/50"
                    onClick={() => setSelectedRiderId(rider.id)}
                  >
                    <RadioGroupItem value={rider.id} id={rider.id} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium truncate">{rider.profile_name}</p>
                        <Badge variant={rider.type === 'vendor' ? 'default' : 'secondary'} className="text-xs">
                          {rider.type === 'vendor' ? 'Your Rider' : 'Company'}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <Star className="w-3 h-3" /> {rider.rating.toFixed(1)}
                        <span>•</span>
                        {rider.total_deliveries} deliveries
                        <span>•</span>
                        <MapPin className="w-3 h-3" /> {rider.distance.toFixed(1)}km
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </RadioGroup>

            <Button 
              onClick={handleManualAssign} 
              disabled={assigning || !selectedRiderId}
              className="w-full"
            >
              {assigning ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Users className="w-4 h-4 mr-2" />}
              Assign Selected Rider
            </Button>
          </>
        ) : (
          <div className="text-center py-4 bg-muted/50 rounded-lg">
            <Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">No affiliated riders online</p>
          </div>
        )}

        {/* Dispatch Publicly button */}
        <div className="pt-2 border-t">
          <p className="text-xs text-muted-foreground mb-2 text-center">
            {availableRiders.length > 0 
              ? "Or broadcast to all platform riders:" 
              : "Dispatch to platform riders instead:"}
          </p>
          <Button 
            variant="outline"
            onClick={handleDispatchPublic} 
            disabled={dispatchingPublic}
            className="w-full"
          >
            {dispatchingPublic ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Globe className="w-4 h-4 mr-2" />
            )}
            Dispatch Publicly
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
