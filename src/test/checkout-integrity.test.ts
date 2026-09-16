import { describe, it, expect } from 'vitest';
import {
  resolveAttemptKey,
  checkDeliveryQuote,
  quoteSurvivesChange,
  isShortWindowDuplicate,
  canFulfil,
  expectedDeliveryFee,
  settlementReferences,
  type QuoteBinding,
  type CheckoutSubmission,
} from '@/lib/checkoutIntegrity';

const NOW = new Date('2026-09-16T17:00:00Z');
const later = (min: number) => new Date(NOW.getTime() + min * 60_000).toISOString();

const quote = (over: Partial<QuoteBinding> = {}): QuoteBinding => ({
  quoteId: 'q1',
  userId: 'u1',
  vendorId: 'v1',
  outletId: 'o1',
  destLat: 6.583249,
  destLng: 3.207132,
  deliveryFee: 800,
  expiresAt: later(15),
  consumed: false,
  ...over,
});

const submission = (over: Partial<CheckoutSubmission> = {}): CheckoutSubmission => ({
  userId: 'u1',
  vendorId: 'v1',
  outletId: 'o1',
  deliveryType: 'delivery',
  deliveryLat: 6.583249,
  deliveryLng: 3.207132,
  deliveryFee: 800,
  extraPackageFee: 0,
  quoteId: 'q1',
  ...over,
});

describe('checkout attempt keys', () => {
  let n = 0;
  const gen = () => `key-${++n}`;

  it('reuses the same key across retries of one attempt (double tap, timeout retry)', () => {
    const first = resolveAttemptKey({ key: null, placed: false }, gen);
    const retry = resolveAttemptKey({ key: first, placed: false }, gen);
    const secondRetry = resolveAttemptKey({ key: first, placed: false }, gen);
    expect(retry).toBe(first);
    expect(secondRetry).toBe(first);
  });

  it('issues a new key for a deliberate reorder of the same cart', () => {
    const first = resolveAttemptKey({ key: null, placed: false }, gen);
    const reorder = resolveAttemptKey({ key: first, placed: true }, gen);
    expect(reorder).not.toBe(first);
  });
});

describe('short-window duplicate guard', () => {
  const incoming = { userId: 'u1', vendorId: 'v1', outletId: 'o1', deliveryType: 'delivery' as const, total: 3760 };

  it('treats an identical order two seconds earlier as a duplicate', () => {
    const existing = { ...incoming, createdAt: new Date(NOW.getTime() - 2000).toISOString(), status: 'pending' };
    expect(isShortWindowDuplicate(existing, incoming, NOW)).toBe(true);
  });

  it('allows the same cart to be ordered again later', () => {
    const existing = { ...incoming, createdAt: new Date(NOW.getTime() - 20 * 60_000).toISOString(), status: 'preparing' };
    expect(isShortWindowDuplicate(existing, incoming, NOW)).toBe(false);
  });

  it('ignores cancelled orders and different branches', () => {
    const cancelled = { ...incoming, createdAt: new Date(NOW.getTime() - 5000).toISOString(), status: 'cancelled' };
    expect(isShortWindowDuplicate(cancelled, incoming, NOW)).toBe(false);
    const otherBranch = { ...incoming, outletId: 'o2', createdAt: new Date(NOW.getTime() - 5000).toISOString(), status: 'pending' };
    expect(isShortWindowDuplicate(otherBranch, incoming, NOW)).toBe(false);
  });
});

describe('server-authoritative delivery quote', () => {
  it('accepts a fresh matching quote', () => {
    expect(checkDeliveryQuote(submission(), quote(), NOW)).toBeNull();
  });

  it('requires a quote for delivery orders', () => {
    expect(checkDeliveryQuote(submission({ quoteId: null }), null, NOW)).toBe('DELIVERY_QUOTE_REQUIRED');
  });

  it('needs no quote for carryout', () => {
    expect(checkDeliveryQuote(submission({ deliveryType: 'self_pickup', quoteId: null, deliveryFee: 0 }), null, NOW)).toBeNull();
  });

  it('rejects an expired quote', () => {
    expect(checkDeliveryQuote(submission(), quote({ expiresAt: later(-1) }), NOW)).toBe('DELIVERY_QUOTE_STALE');
  });

  it('rejects a quote already used by another order', () => {
    expect(checkDeliveryQuote(submission(), quote({ consumed: true }), NOW)).toBe('DELIVERY_QUOTE_STALE');
  });

  it("rejects another customer's quote", () => {
    expect(checkDeliveryQuote(submission(), quote({ userId: 'someone-else' }), NOW)).toBe('DELIVERY_QUOTE_STALE');
  });

  it('rejects a quote issued for a different branch', () => {
    expect(checkDeliveryQuote(submission({ outletId: 'o2' }), quote(), NOW)).toBe('DELIVERY_QUOTE_OUTLET_MISMATCH');
  });

  it('rejects a different delivery destination', () => {
    expect(checkDeliveryQuote(submission({ deliveryLat: 6.7 }), quote(), NOW)).toBe('DELIVERY_QUOTE_LOCATION_MISMATCH');
  });

  it('ignores a client-tampered delivery fee, including a silently dropped base fee', () => {
    expect(checkDeliveryQuote(submission({ deliveryFee: 0 }), quote(), NOW)).toBe('DELIVERY_FEE_MISMATCH');
    expect(checkDeliveryQuote(submission({ deliveryFee: 100 }), quote(), NOW)).toBe('DELIVERY_FEE_MISMATCH');
  });

  it('allows the extra-package fee on top of the quoted fee', () => {
    expect(expectedDeliveryFee(800, 200)).toBe(1000);
    expect(checkDeliveryQuote(submission({ deliveryFee: 1000, extraPackageFee: 200 }), quote(), NOW)).toBeNull();
  });

  it('drops the quote when the customer detours through carryout and back', () => {
    const q = quote();
    const afterCarryout = quoteSurvivesChange(q, { deliveryType: 'self_pickup', outletId: 'o1', destLat: q.destLat, destLng: q.destLng });
    expect(afterCarryout).toBeNull();
    const backToDelivery = quoteSurvivesChange(afterCarryout, { deliveryType: 'delivery', outletId: 'o1', destLat: q.destLat, destLng: q.destLng });
    expect(backToDelivery).toBeNull();
    expect(checkDeliveryQuote(submission(), backToDelivery, NOW)).toBe('DELIVERY_QUOTE_REQUIRED');
  });

  it('drops the quote when the address or branch changes', () => {
    const q = quote();
    expect(quoteSurvivesChange(q, { deliveryType: 'delivery', outletId: 'o1', destLat: 6.9, destLng: 3.2 })).toBeNull();
    expect(quoteSurvivesChange(q, { deliveryType: 'delivery', outletId: 'o2', destLat: q.destLat, destLng: q.destLng })).toBeNull();
    expect(quoteSurvivesChange(q, { deliveryType: 'delivery', outletId: 'o1', destLat: q.destLat, destLng: q.destLng })).toBe(q);
  });
});

describe('unpaid orders cannot be fulfilled', () => {
  const unpaid = { channel: 'online', paymentStatus: 'pending', paymentMethod: 'wallet' };

  it('refuses rider assignment on an unpaid wallet order', () => {
    expect(canFulfil(unpaid, undefined, true)).toBe(false);
  });

  it('refuses delivered/preparing on an unpaid wallet order', () => {
    expect(canFulfil(unpaid, 'delivered')).toBe(false);
    expect(canFulfil(unpaid, 'preparing')).toBe(false);
  });

  it('still allows cancelling an unpaid order', () => {
    expect(canFulfil(unpaid, 'cancelled')).toBe(true);
  });

  it('allows fulfilment once paid, and for POS and cash channels', () => {
    expect(canFulfil({ ...unpaid, paymentStatus: 'paid' }, 'delivered', true)).toBe(true);
    expect(canFulfil({ channel: 'pos', paymentStatus: 'pending' }, 'delivered', true)).toBe(true);
    expect(canFulfil({ channel: 'assisted', paymentStatus: 'pending' }, 'preparing')).toBe(true);
    expect(canFulfil({ channel: 'online', paymentStatus: 'pending', paymentMethod: 'cash' }, 'delivered', true)).toBe(true);
  });
});

describe('settlement is idempotent by order', () => {
  it('derives one deterministic reference per posting per order', () => {
    const a = settlementReferences('38942122-cd18-4f49-8b04-3854595eff49');
    const b = settlementReferences('38942122-cd18-4f49-8b04-3854595eff49');
    expect(a).toEqual(b);
    expect(a.riderShare).toBe('RIDER-SHARE-38942122-cd18-4f49-8b04-3854595eff49');
    expect(settlementReferences('cb87b3ce-6ccd-4d1d-8f2b-b53b4fa79f02').riderShare).not.toBe(a.riderShare);
  });
});
