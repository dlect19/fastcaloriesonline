import { supabase } from '@/integrations/supabase/client';

/**
 * ONE effective-availability rule, shared by every ordering surface
 * (customer app, Assisted Order, POS lookups, checkout validation).
 *
 * Order of precedence:
 *   1. hidden product            -> never orderable
 *   2. tracked stock exhausted   -> not orderable
 *   3. branch override present   -> branch value wins
 *   4. otherwise                 -> global products.is_available
 *
 * Mirrors the SQL function `public.product_effective_available(product, outlet)`.
 */
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

/** Branch-level availability overrides for the given products. */
export async function fetchOutletOverrides(
  outletId: string | null | undefined,
  productIds: string[],
): Promise<OutletOverrideMap> {
  if (!outletId || productIds.length === 0) return {};
  const { data } = await supabase
    .from('outlet_product_overrides')
    .select('product_id, is_available')
    .eq('outlet_id', outletId)
    .in('product_id', productIds);
  const map: OutletOverrideMap = {};
  (data || []).forEach((row: any) => {
    if (row.is_available !== null && row.is_available !== undefined) {
      map[row.product_id] = !!row.is_available;
    }
  });
  return map;
}
