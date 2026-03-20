import { useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { DispatchStatus } from '@/components/vendor/DispatchStatus';
import { ManualRiderAssignment } from '@/components/vendor/ManualRiderAssignment';
import { OrderRiderInfo } from '@/components/vendor/OrderRiderInfo';
import type { Tables, Database } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;
type Order = Tables<'orders'>;
type OrderStatus = Database['public']['Enums']['order_status'];

interface RiderAssignmentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order | null;
  vendor: Vendor | null;
  onAssigned: () => void;
}

export function RiderAssignmentDialog({ open, onOpenChange, order, vendor, onAssigned }: RiderAssignmentDialogProps) {
  const canUseMap = useMemo(() => {
    const lat = vendor?.latitude;
    const lng = vendor?.longitude;
    return !!lat && !!lng;
  }, [vendor?.latitude, vendor?.longitude]);

  const shouldShowDispatchStatus =
    !!order &&
    order.delivery_type !== 'self_pickup' &&
    !order.rider_id &&
    (order.status as OrderStatus) === 'searching_for_rider';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Rider Assignment
            {order?.status && (
              <Badge variant="secondary" className="capitalize">
                {String(order.status).split('_').join(' ')}
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription>
            {order ? `Order ${order.order_number}` : 'Select an order to assign a rider.'}
          </DialogDescription>
        </DialogHeader>

        {!order ? null : order.delivery_type === 'self_pickup' ? (
          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">
              This is a carryout order—no rider is required.
            </CardContent>
          </Card>
        ) : order.rider_id ? (
          <div className="space-y-3">
            <Card>
              <CardContent className="py-4 text-sm text-muted-foreground">
                A rider is already assigned to this order.
              </CardContent>
            </Card>
            <OrderRiderInfo riderId={order.rider_id} orderStatus={order.status} />
          </div>
        ) : (
          <div className="space-y-4">
            {shouldShowDispatchStatus && (
              <DispatchStatus
                orderId={order.id}
                orderNumber={order.order_number}
                vendorId={order.vendor_id}
                vendorLat={vendor?.latitude ?? undefined}
                vendorLng={vendor?.longitude ?? undefined}
                onRiderAssigned={onAssigned}
              />
            )}

            {canUseMap ? (
              <ManualRiderAssignment
                orderId={order.id}
                orderNumber={order.order_number}
                vendorId={order.vendor_id}
                // vendor latitude/longitude are numerics in the backend; coercion is safe here.
                vendorLat={Number(vendor!.latitude)}
                vendorLng={Number(vendor!.longitude)}
                onAssigned={onAssigned}
              />
            ) : (
              <Card className="border-warning/30 bg-warning/5">
                <CardContent className="py-4">
                  <p className="text-sm text-warning">
                    ⚠️ Set your store location in Settings to assign riders
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
