import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Loader2, AlertTriangle, Users } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ReassignOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: any;
  onReassigned: () => void;
}

interface AvailableRider {
  id: string;
  user_id: string;
  profile_name: string;
  rating: number;
  total_deliveries: number;
  distance: number;
}

const REASSIGNMENT_REASONS = [
  'Vehicle breakdown',
  'Medical emergency',
  'Family emergency',
  'Route issue / Road blocked',
  'Other technical issue'
];

export function ReassignOrderDialog({ open, onOpenChange, order, onReassigned }: ReassignOrderDialogProps) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [customReason, setCustomReason] = useState('');
  const [availableRiders, setAvailableRiders] = useState<AvailableRider[]>([]);
  const [selectedRiderId, setSelectedRiderId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [fetchingRiders, setFetchingRiders] = useState(false);

  useEffect(() => {
    if (open && order) {
      fetchAvailableRiders();
    }
  }, [open, order]);

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
    setFetchingRiders(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get vendor location from order
      const vendorLat = order.vendors?.latitude;
      const vendorLng = order.vendors?.longitude;

      // Fetch online, verified riders except the current one
      const { data: riders } = await supabase
        .from('rider_profiles')
        .select('id, user_id, current_latitude, current_longitude, preferred_latitude, preferred_longitude, rating, total_deliveries')
        .eq('is_online', true)
        .eq('is_verified', true)
        .eq('is_email_verified', true)
        .neq('user_id', user.id);

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

      // Calculate distances and filter/sort
      const ridersWithDistance = riders
        .map(rider => {
          const riderLat = rider.current_latitude || rider.preferred_latitude;
          const riderLng = rider.current_longitude || rider.preferred_longitude;

          let distance = 999;
          if (riderLat && riderLng && vendorLat && vendorLng) {
            distance = calculateDistance(vendorLat, vendorLng, riderLat, riderLng);
          }

          return {
            id: rider.id,
            user_id: rider.user_id,
            profile_name: profileMap.get(rider.user_id) || 'Rider',
            rating: rider.rating || 0,
            total_deliveries: rider.total_deliveries || 0,
            distance
          };
        })
        .filter(r => r.distance < 20) // Within 20km
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 10);

      setAvailableRiders(ridersWithDistance);
    } catch (error) {
      console.error('Error fetching riders:', error);
    } finally {
      setFetchingRiders(false);
    }
  };

  const handleReassign = async () => {
    const finalReason = reason === 'Other technical issue' ? customReason : reason;
    
    if (!finalReason.trim()) {
      toast({
        title: 'Please provide a reason',
        variant: 'destructive'
      });
      return;
    }

    if (!selectedRiderId) {
      toast({
        title: 'Please select a rider',
        variant: 'destructive'
      });
      return;
    }

    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const selectedRider = availableRiders.find(r => r.id === selectedRiderId);
      if (!selectedRider) throw new Error('Rider not found');

      // Create reassignment record
      await supabase
        .from('order_reassignments')
        .insert({
          order_id: order.id,
          original_rider_id: user.id,
          new_rider_id: selectedRider.user_id,
          reason: finalReason,
          original_rider_share: 0.3,
          new_rider_share: 0.7
        });

      // Update order with new rider
      await supabase
        .from('orders')
        .update({
          rider_id: selectedRider.user_id,
          status: order.status === 'on_the_way' ? 'picked_up' : order.status
        })
        .eq('id', order.id);

      toast({ title: '✅ Order reassigned successfully' });
      onOpenChange(false);
      onReassigned();
    } catch (error: any) {
      toast({
        title: 'Error reassigning order',
        description: error.message,
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-warning" />
            Reassign Order
          </DialogTitle>
          <DialogDescription>
            Transfer this order to another available rider. Your earnings will be split based on work completed.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-4">
          {/* Reason Selection */}
          <div className="space-y-3">
            <Label>Why do you need to reassign?</Label>
            <RadioGroup value={reason} onValueChange={setReason}>
              {REASSIGNMENT_REASONS.map((r) => (
                <div key={r} className="flex items-center space-x-2">
                  <RadioGroupItem value={r} id={r} />
                  <Label htmlFor={r} className="font-normal cursor-pointer">{r}</Label>
                </div>
              ))}
            </RadioGroup>
            
            {reason === 'Other technical issue' && (
              <Textarea
                placeholder="Describe the issue..."
                value={customReason}
                onChange={(e) => setCustomReason(e.target.value)}
                className="mt-2"
              />
            )}
          </div>

          {/* Available Riders */}
          <div className="space-y-3">
            <Label className="flex items-center gap-2">
              <Users className="w-4 h-4" />
              Select New Rider
            </Label>
            
            {fetchingRiders ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : availableRiders.length === 0 ? (
              <div className="text-center py-6 bg-secondary rounded-lg">
                <Users className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">No available riders nearby</p>
              </div>
            ) : (
              <RadioGroup value={selectedRiderId} onValueChange={setSelectedRiderId}>
                <div className="space-y-2">
                  {availableRiders.map((rider) => (
                    <div 
                      key={rider.id} 
                      className="flex items-center space-x-3 p-3 border rounded-lg cursor-pointer hover:bg-secondary/50"
                      onClick={() => setSelectedRiderId(rider.id)}
                    >
                      <RadioGroupItem value={rider.id} id={rider.id} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{rider.profile_name}</p>
                        <p className="text-xs text-muted-foreground">
                          ⭐ {rider.rating.toFixed(1)} • {rider.total_deliveries} deliveries • {rider.distance.toFixed(1)}km away
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </RadioGroup>
            )}
          </div>

          {/* Earnings Info */}
          <div className="p-3 bg-warning/10 rounded-lg text-sm">
            <p className="font-medium text-warning">Earnings Split</p>
            <p className="text-muted-foreground mt-1">
              You'll receive 30% of the delivery fee for work done. The new rider gets 70%.
            </p>
          </div>
        </div>

        <div className="flex gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Cancel
          </Button>
          <Button 
            onClick={handleReassign} 
            disabled={loading || !reason || !selectedRiderId}
            className="flex-1"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Reassign Order'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
