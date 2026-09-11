// Server-side twin of src/lib/effectiveAvailability.ts and the SQL function
// public.product_effective_available(product, outlet). Every ordering channel
// (WhatsApp webhook, wa-session, order validation) must use this rule so a
// vendor's availability toggle means the same thing everywhere.

export interface AvailabilityProduct {
  id: string;
  is_available?: boolean | null;
  is_hidden?: boolean | null;
  track_stock?: boolean | null;
  stock_quantity?: number | null;
}

export type OutletOverrideMap = Record<string, boolean>;

export function isEffectivelyAvailable(
  product: AvailabilityProduct,
  overrides?: OutletOverrideMap | null,
): boolean {
  if (product.is_hidden) return false;
  if (product.track_stock && (product.stock_quantity ?? 0) <= 0) return false;
  const override = overrides?.[product.id];
  if (override !== undefined) return override;
  return !!product.is_available;
}

export async function fetchOutletOverrides(
  supabase: any,
  outletId: string | null | undefined,
  productIds: string[],
): Promise<OutletOverrideMap> {
  if (!outletId || productIds.length === 0) return {};
  const { data } = await supabase
    .from("outlet_product_overrides")
    .select("product_id, is_available")
    .eq("outlet_id", outletId)
    .in("product_id", productIds);
  const map: OutletOverrideMap = {};
  (data || []).forEach((row: any) => {
    if (row.is_available !== null && row.is_available !== undefined) {
      map[row.product_id] = !!row.is_available;
    }
  });
  return map;
}

/** The branch a channel should evaluate availability against. */
export async function resolveDefaultOutletId(
  supabase: any,
  vendorId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("vendor_outlets")
    .select("id, is_default")
    .eq("vendor_id", vendorId)
    .eq("is_active", true);
  const rows = data || [];
  return (rows.find((o: any) => o.is_default) || rows[0])?.id ?? null;
}
