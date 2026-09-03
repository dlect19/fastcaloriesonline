/**
 * Product-level selling unit ("how is this sold?") used by the vendor menu,
 * the POS (online + offline) and receipts.
 *
 * Source of truth is `products.portion_unit` (already present for every
 * product). `products.pack_unit_label` remains the pharmacy pack label and
 * `products.allows_fractional_qty` decides whether decimals are allowed.
 */

export const SELLING_UNIT_OPTIONS = [
  { value: 'portion', label: 'Portion' },
  { value: 'plate', label: 'Plate' },
  { value: 'bowl', label: 'Bowl' },
  { value: 'cup', label: 'Cup' },
  { value: 'piece', label: 'Piece' },
  { value: 'bottle', label: 'Bottle' },
  { value: 'pack', label: 'Pack' },
  { value: 'sachet', label: 'Sachet' },
  { value: 'kg', label: 'Kilogram' },
  { value: 'litre', label: 'Litre' },
] as const;

/** Units that are naturally divisible (rice by portion, drinks by litre...). */
export const DIVISIBLE_UNITS = new Set([
  'portion', 'plate', 'bowl', 'cup', 'kg', 'litre', 'liter', 'gram', 'g', 'ml',
]);

export function isDivisibleUnit(unit?: string | null): boolean {
  return DIVISIBLE_UNITS.has(String(unit || '').trim().toLowerCase());
}

export interface SellingUnitSource {
  portion_unit?: string | null;
  pack_unit_label?: string | null;
  serving_unit?: string | null;
  allows_sachet?: boolean | null;
  allows_fractional_qty?: boolean | null;
}

/**
 * Resolve the label a product is sold by. Order of preference:
 * 1. `portion_unit` (the selling unit vendors configure)
 * 2. `serving_unit` text ("per plate" -> "plate")
 * 3. `pack_unit_label` (pharmacy pack products)
 * 4. legacy fallback: 'pack'
 */
export function resolveSellingUnit(p?: SellingUnitSource | null): string {
  const portion = String(p?.portion_unit || '').trim().toLowerCase();
  if (portion) return portion;
  const serving = String(p?.serving_unit || '').trim().toLowerCase();
  const m = serving.match(/^per\s+(.+)$/);
  if (m?.[1]) return m[1];
  if (serving) return serving;
  const pack = String(p?.pack_unit_label || '').trim().toLowerCase();
  if (pack) return pack;
  return 'pack';
}

/** Whether this product may be sold in fractional quantities (0.5, 1.5, ...). */
export function resolveAllowsFraction(p?: SellingUnitSource | null): boolean {
  if (p?.allows_fractional_qty != null) return !!p.allows_fractional_qty;
  if (p?.allows_sachet) return false;
  return isDivisibleUnit(resolveSellingUnit(p));
}

export function pluralizeUnit(unit: string, qty: number): string {
  const u = String(unit || '').trim();
  if (!u) return '';
  if (qty === 1) return u;
  if (['kg', 'g', 'ml', 'litre', 'liter', 'l'].includes(u.toLowerCase())) return u;
  return `${u}s`;
}
