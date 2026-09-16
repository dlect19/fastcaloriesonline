/**
 * Checkout integrity rules shared by the customer app and mirrored exactly by
 * the database triggers `enforce_checkout_integrity` and
 * `guard_unpaid_order_fulfilment` (migration 0017).
 *
 * The database is the authority — these helpers exist so the app can fail early
 * with a friendly message, and so the rules are covered by tests.
 */

export const DUPLICATE_WINDOW_MS = 120_000;
/** Coordinates may drift by this much (~150m) between quote and checkout. */
export const QUOTE_COORD_TOLERANCE = 0.0015;
/** Delivery fee tolerance in naira. */
export const FEE_TOLERANCE = 0.5;

export type FulfilmentType = 'delivery' | 'self_pickup';

export interface CheckoutAttempt {
  /** Key kept for the whole attempt, including retries. Null before the first try. */
  key: string | null;
  /** True once an order has actually been placed with the key. */
  placed: boolean;
}

/**
 * One key per checkout attempt: retries reuse it (so a timed-out or
 * double-tapped attempt maps to one order), a new attempt after a placed order
 * gets a fresh one (so a deliberate reorder is never blocked).
 */
export function resolveAttemptKey(attempt: CheckoutAttempt, generate: () => string): string {
  if (attempt.key && !attempt.placed) return attempt.key;
  return generate();
}

export interface QuoteBinding {
  quoteId: string | null;
  userId: string;
  vendorId: string;
  outletId: string | null;
  destLat: number;
  destLng: number;
  deliveryFee: number;
  expiresAt: string;
  consumed: boolean;
}

export interface CheckoutSubmission {
  userId: string;
  vendorId: string;
  outletId: string | null;
  deliveryType: FulfilmentType;
  deliveryLat: number | null;
  deliveryLng: number | null;
  deliveryFee: number;
  extraPackageFee: number;
  quoteId: string | null;
}

export type QuoteRejection =
  | 'DELIVERY_QUOTE_REQUIRED'
  | 'DELIVERY_QUOTE_STALE'
  | 'DELIVERY_QUOTE_OUTLET_MISMATCH'
  | 'DELIVERY_QUOTE_LOCATION_MISMATCH'
  | 'DELIVERY_FEE_MISMATCH';

/** The delivery fee an order may carry: the quoted fee plus extra-package fees. */
export function expectedDeliveryFee(quoteFee: number, extraPackageFee: number): number {
  return quoteFee + (extraPackageFee || 0);
}

/**
 * Returns null when the submission may proceed, otherwise the machine-readable
 * reason the delivery quote is not acceptable.
 */
export function checkDeliveryQuote(
  submission: CheckoutSubmission,
  quote: QuoteBinding | null,
  now: Date = new Date(),
): QuoteRejection | null {
  // Carryout carries no delivery pricing at all.
  if (submission.deliveryType !== 'delivery') return null;

  if (!submission.quoteId || !quote || !quote.quoteId) return 'DELIVERY_QUOTE_REQUIRED';

  const expired = new Date(quote.expiresAt).getTime() <= now.getTime();
  if (
    expired ||
    quote.consumed ||
    quote.quoteId !== submission.quoteId ||
    quote.userId !== submission.userId ||
    quote.vendorId !== submission.vendorId
  ) {
    return 'DELIVERY_QUOTE_STALE';
  }

  if (quote.outletId && submission.outletId && quote.outletId !== submission.outletId) {
    return 'DELIVERY_QUOTE_OUTLET_MISMATCH';
  }

  if (
    submission.deliveryLat === null ||
    submission.deliveryLng === null ||
    Math.abs(submission.deliveryLat - quote.destLat) > QUOTE_COORD_TOLERANCE ||
    Math.abs(submission.deliveryLng - quote.destLng) > QUOTE_COORD_TOLERANCE
  ) {
    return 'DELIVERY_QUOTE_LOCATION_MISMATCH';
  }

  const expected = expectedDeliveryFee(quote.deliveryFee, submission.extraPackageFee);
  if (Math.abs(submission.deliveryFee - expected) > FEE_TOLERANCE) return 'DELIVERY_FEE_MISMATCH';

  return null;
}

/**
 * Switching to carryout drops the quote; switching back to delivery, or
 * changing address/branch, means the previous quote can no longer be used.
 */
export function quoteSurvivesChange(
  quote: QuoteBinding | null,
  next: { deliveryType: FulfilmentType; outletId: string | null; destLat: number | null; destLng: number | null },
): QuoteBinding | null {
  if (!quote || next.deliveryType !== 'delivery') return null;
  if (next.destLat === null || next.destLng === null) return null;
  if (quote.outletId && next.outletId && quote.outletId !== next.outletId) return null;
  if (
    Math.abs(quote.destLat - next.destLat) > QUOTE_COORD_TOLERANCE ||
    Math.abs(quote.destLng - next.destLng) > QUOTE_COORD_TOLERANCE
  ) {
    return null;
  }
  return quote;
}

export interface DuplicateCandidate {
  userId: string;
  vendorId: string;
  outletId: string | null;
  deliveryType: FulfilmentType;
  total: number;
  createdAt: string;
  status: string;
}

/** Mirrors the database short-window guard. */
export function isShortWindowDuplicate(
  existing: DuplicateCandidate,
  incoming: Omit<DuplicateCandidate, 'createdAt' | 'status'>,
  now: Date = new Date(),
): boolean {
  if (existing.status === 'cancelled') return false;
  if (existing.userId !== incoming.userId) return false;
  if (existing.vendorId !== incoming.vendorId) return false;
  if ((existing.outletId ?? '') !== (incoming.outletId ?? '')) return false;
  if (existing.deliveryType !== incoming.deliveryType) return false;
  if (existing.total !== incoming.total) return false;
  return now.getTime() - new Date(existing.createdAt).getTime() < DUPLICATE_WINDOW_MS;
}

export interface FulfilmentCheck {
  channel?: string | null;
  paymentStatus: string;
  paymentMethod?: string | null;
  riderId?: string | null;
  status?: string | null;
}

export const FULFILMENT_STATUSES = [
  'confirmed',
  'preparing',
  'ready_for_pickup',
  'searching_for_rider',
  'assigned',
  'picked_up',
  'on_the_way',
  'delivered',
];

/**
 * Mirrors `guard_unpaid_order_fulfilment`: an unpaid app/web/WhatsApp order can
 * neither be assigned to a rider nor moved into a fulfilment status.
 */
export function canFulfil(order: FulfilmentCheck, nextStatus?: string, assigningRider = false): boolean {
  const channel = order.channel || 'online';
  if (channel !== 'online' && channel !== 'whatsapp') return true;
  if ((order.paymentMethod || 'wallet') === 'cash') return true;
  if (order.paymentStatus === 'paid') return true;
  if (assigningRider) return false;
  if (nextStatus && FULFILMENT_STATUSES.includes(nextStatus)) return false;
  return true;
}

/** Deterministic settlement references — repeating a completion cannot mint money. */
export function settlementReferences(orderId: string) {
  return {
    riderShare: `RIDER-SHARE-${orderId}`,
    platformDelivery: `PLATFORM-DELIVERY-${orderId}`,
    vendorShare: `VENDOR-SHARE-${orderId}`,
    platformCommission: `PLATFORM-COMMISSION-${orderId}`,
  };
}
