import { useEffect, useMemo } from 'react';
import { VendorGroup, useCart } from '@/hooks/useCart';
import { CartItemCard } from '@/components/cart/CartItemCard';
import { TakeawayPackDisplay } from '@/components/cart/TakeawayPackDisplay';
import { PackageSelector } from '@/components/cart/PackageSelector';
import { PackageMetaForm } from '@/components/cart/PackageMetaForm';
import { useTakeawayPacks } from '@/hooks/useTakeawayPacks';
import { useDeliveryFee } from '@/hooks/useDeliveryFee';
import { Store, Navigation, Trash2, Package, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';

interface VendorGroupCardProps {
  group: VendorGroup;
  vendorLocation: { latitude: number | null; longitude: number | null; address: string | null };
  customerLat: number | null;
  customerLon: number | null;
  deliveryType: 'delivery' | 'self_pickup';
  onClearGroup: (vendorId: string, outletId?: string) => void;
  onFeesCalculated: (vendorId: string, deliveryFee: number, packagingFee: number, distanceKm: number | null, surgeFee: number, feeLoading: boolean) => void;
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
  const { getExtraPackageFee, extraPackageFeePerPack } = useCart();

  const { fee: calculatedDeliveryFee, distanceKm, surgeFee, loading: feeLoading } = useDeliveryFee({
    vendorLat: vendorLocation.latitude,
    vendorLon: vendorLocation.longitude,
    customerLat,
    customerLon,
  });

  const deliveryFee = deliveryType === 'self_pickup' ? 0 : calculatedDeliveryFee;
  const extraPackageFee = deliveryType === 'self_pickup' ? 0 : getExtraPackageFee(group.vendorId, group.outletId);

  // Calculate takeaway packs PER PACKAGE (each package is a separate food pack)
  const perPackagePacks = useMemo(() => {
    return group.packages.map((pkg) => {
      const pkgPacks = getApplicablePacks(pkg.items.map(item => ({ productId: item.productId, quantity: item.quantity })));
      return { packageIndex: pkg.packageIndex, packs: pkgPacks };
    });
  }, [group.packages, getApplicablePacks]);

  const allApplicablePacks = useMemo(() => {
    return perPackagePacks.flatMap(pp => pp.packs);
  }, [perPackagePacks]);

  const packagingFee = useMemo(() => {
    return allApplicablePacks.reduce((sum, pack) => sum + pack.price, 0);
  }, [allApplicablePacks]);

  // Report fees back to parent (include extra package fee in delivery fee)
  useMemo(() => {
    onFeesCalculated(group.vendorId, deliveryFee + extraPackageFee, packagingFee, distanceKm, deliveryType === 'self_pickup' ? 0 : (surgeFee || 0), feeLoading);
  }, [group.vendorId, deliveryFee, extraPackageFee, packagingFee, distanceKm, surgeFee, deliveryType, feeLoading]);

  const hasMultiplePackages = group.packageCount > 1;

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
          {hasMultiplePackages && (
            <Badge variant="secondary" className="text-xs gap-1">
              <Users className="w-3 h-3" />
              {group.packageCount} packs
            </Badge>
          )}
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

      {/* Package Selector */}
      <div className="px-4 pt-3">
        <PackageSelector vendorId={group.vendorId} outletId={group.outletId} />
      </div>

      {/* Items grouped by package */}
      {hasMultiplePackages ? (
        <div className="p-4 space-y-4">
          {group.packages.map((pkg) => {
            const pkgPackData = perPackagePacks.find(pp => pp.packageIndex === pkg.packageIndex);
            const pkgPacks = pkgPackData?.packs || [];
            return (
              <div key={pkg.packageIndex} className="space-y-3">
                <div className="flex items-center gap-2">
                  <Package className="w-4 h-4 text-primary" />
                  <span className="text-sm font-semibold text-foreground">
                    {pkg.recipientName || `Package ${pkg.packageIndex + 1}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({pkg.itemCount} item{pkg.itemCount !== 1 ? 's' : ''})
                  </span>
                </div>
                {pkg.note && (
                  <p className="text-xs text-muted-foreground bg-secondary/50 rounded px-2 py-1">
                    📝 {pkg.note}
                  </p>
                )}
                <PackageMetaForm
                  vendorId={group.vendorId}
                  packageIndex={pkg.packageIndex}
                  outletId={group.outletId}
                />
                {pkg.items.length > 0 ? (
                  <div className="space-y-2">
                    {pkg.items.map((item) => (
                      <CartItemCard key={item.id} item={item} />
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground text-center py-2">No items in this package</p>
                )}
                {/* Takeaway pack for this specific package */}
                {pkgPacks.length > 0 && (
                  <TakeawayPackDisplay packs={pkgPacks} />
                )}
                {pkg.packageIndex < group.packages.length - 1 && (
                  <Separator />
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-4 space-y-3">
          {group.items.map((item) => (
            <CartItemCard key={item.id} item={item} />
          ))}
        </div>
      )}

      {/* Takeaway Packs (single package mode) */}
      {!hasMultiplePackages && allApplicablePacks.length > 0 && (
        <div className="px-4 pb-3">
          <TakeawayPackDisplay packs={allApplicablePacks} />
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
            <>
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
              {extraPackageFee > 0 && (
                <div className="flex justify-between text-xs text-primary pl-4">
                  <span>↳ Extra package fee ({group.packageCount - 1} × ₦{extraPackageFeePerPack.toLocaleString()})</span>
                  <span>₦{extraPackageFee.toLocaleString()}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
