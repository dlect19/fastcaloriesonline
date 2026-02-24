import { useMemo } from 'react';
import { VendorGroup } from '@/hooks/useCart';
import { CartItemCard } from '@/components/cart/CartItemCard';
import { TakeawayPackDisplay } from '@/components/cart/TakeawayPackDisplay';
import { useTakeawayPacks } from '@/hooks/useTakeawayPacks';
import { useDeliveryFee } from '@/hooks/useDeliveryFee';
import { Store, Navigation, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';

interface VendorGroupCardProps {
  group: VendorGroup;
  vendorLocation: { latitude: number | null; longitude: number | null; address: string | null };
  customerLat: number | null;
  customerLon: number | null;
  deliveryType: 'delivery' | 'self_pickup';
  onClearGroup: (vendorId: string, outletId?: string) => void;
  /** Called with (vendorId, fee, packagingFee, distanceKm) whenever they change */
  onFeesCalculated: (vendorId: string, deliveryFee: number, packagingFee: number, distanceKm: number | null, surgeFee: number) => void;
}

export function VendorGroupCard({
  group,
  vendorLocation,
  customerLat,
  customerLon,
  deliveryType,
  onClearGroup,
  onFeesCalculated,
}: VendorGroupCardProps) {
  const { getApplicablePacks } = useTakeawayPacks(group.vendorId);

  const { fee: calculatedDeliveryFee, distanceKm, surgeFee } = useDeliveryFee({
    vendorLat: vendorLocation.latitude,
    vendorLon: vendorLocation.longitude,
    customerLat,
    customerLon,
  });

  const deliveryFee = deliveryType === 'self_pickup' ? 0 : calculatedDeliveryFee;

  const applicablePacks = useMemo(() => {
    return getApplicablePacks(group.items.map(item => ({ productId: item.productId, quantity: item.quantity })));
  }, [group.items, getApplicablePacks]);

  const packagingFee = useMemo(() => {
    return applicablePacks.reduce((sum, pack) => sum + pack.price, 0);
  }, [applicablePacks]);

  // Report fees back to parent whenever they change
  useMemo(() => {
    onFeesCalculated(group.vendorId, deliveryFee, packagingFee, distanceKm, deliveryType === 'self_pickup' ? 0 : (surgeFee || 0));
  }, [group.vendorId, deliveryFee, packagingFee, distanceKm, surgeFee, deliveryType]);

  return (
    <section className="bg-card rounded-xl border border-border overflow-hidden">
      {/* Vendor header */}
      <div className="flex items-center justify-between p-4 bg-secondary/50 border-b border-border">
        <div className="flex items-center gap-2">
          <Store className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-foreground">{group.vendorName}</h3>
          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
            {group.itemCount} item{group.itemCount !== 1 ? 's' : ''}
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive h-8 gap-1"
          onClick={() => onClearGroup(group.vendorId, group.outletId)}
        >
          <Trash2 className="w-3.5 h-3.5" />
          Remove
        </Button>
      </div>

      {/* Items */}
      <div className="p-4 space-y-3">
        {group.items.map((item) => (
          <CartItemCard key={item.id} item={item} />
        ))}
      </div>

      {/* Takeaway Packs */}
      {applicablePacks.length > 0 && (
        <div className="px-4 pb-3">
          <TakeawayPackDisplay packs={applicablePacks} />
        </div>
      )}

      {/* Vendor subtotals */}
      <div className="px-4 pb-4">
        <Separator className="mb-3" />
        <div className="space-y-1.5 text-sm">
          <div className="flex justify-between text-muted-foreground">
            <span>Subtotal</span>
            <span>₦{group.subtotal.toLocaleString()}</span>
          </div>
          {packagingFee > 0 && (
            <div className="flex justify-between text-muted-foreground">
              <span>Packaging</span>
              <span>₦{packagingFee.toLocaleString()}</span>
            </div>
          )}
          {deliveryType === 'delivery' && (
            <div className="flex justify-between text-muted-foreground">
              <div className="flex items-center gap-1">
                <span>Delivery</span>
                {distanceKm !== null && distanceKm > 0 && (
                  <span className="text-xs text-primary flex items-center gap-0.5">
                    <Navigation className="w-3 h-3" />
                    {distanceKm.toFixed(1)} km
                  </span>
                )}
              </div>
              <span>₦{deliveryFee.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
