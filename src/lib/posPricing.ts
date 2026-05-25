/**
 * POS pricing helpers.
 *
 * The platform supports separate "in-store" prices for vendors who charge
 * differently at the counter than online (e.g. because online prices include
 * a commission markup). Pricing mode is configured per outlet.
 */

export type PosPricingMode = 'same' | 'global_discount' | 'per_item';

export interface PosOutletPricingConfig {
  pos_pricing_mode?: PosPricingMode | null;
  pos_global_discount_pct?: number | null;
}

export interface PosProductPricingInput {
  /** Online (regular) price */
  price: number;
  /** Optional online discount price */
  discount_price?: number | null;
  /** Optional vendor-wide in-store price (products.in_store_price) */
  in_store_price?: number | null;
  /** Optional per-outlet in-store price (outlet_product_overrides.in_store_price) */
  outlet_in_store_price?: number | null;
}

/**
 * Returns the effective POS unit price for a product based on the outlet's
 * configured pricing mode.
 *
 * - `same`           → online price (with discount if applicable)
 * - `global_discount`→ online price minus the configured percentage
 * - `per_item`       → outlet override > vendor in-store price > online price
 */
export function computePosPrice(
  product: PosProductPricingInput,
  config: PosOutletPricingConfig | null | undefined,
): number {
  const onlinePrice =
    product.discount_price && product.discount_price < product.price
      ? Number(product.discount_price)
      : Number(product.price);

  const mode: PosPricingMode = (config?.pos_pricing_mode as PosPricingMode) || 'same';

  // Per-outlet override always wins when set
  if (product.outlet_in_store_price != null && Number(product.outlet_in_store_price) > 0) {
    return Number(product.outlet_in_store_price);
  }

  if (mode === 'global_discount') {
    const pct = Math.max(0, Math.min(100, Number(config?.pos_global_discount_pct ?? 0)));
    const discounted = onlinePrice * (1 - pct / 100);
    return Math.max(0, Math.round(discounted * 100) / 100);
  }

  // For 'same' and 'per_item': if vendor set an item-level in-store price, honor it.
  if (product.in_store_price != null && Number(product.in_store_price) > 0) {
    return Number(product.in_store_price);
  }
  return onlinePrice;
}

export const POS_PRICING_MODE_LABELS: Record<PosPricingMode, string> = {
  same: 'Same as online',
  global_discount: 'Global discount %',
  per_item: 'Per-item in-store price',
};
