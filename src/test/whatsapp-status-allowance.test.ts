import { describe, it, expect } from 'vitest';
import {
  computeStatusAllowance,
  parseStatusAllowanceConfig,
  normalizeStatusFulfilment,
  expectedStatusStates,
  statusCostVariance,
  STATUS_ALLOWANCE_DEFAULTS,
  DELIVERY_STATUS_MESSAGE_STATES,
  PICKUP_STATUS_MESSAGE_STATES,
  RIDER_STATUS_MESSAGE_STATES,
} from '../../supabase/functions/_shared/whatsappStatusAllowance.ts';
import {
  formatCallablePhone,
  riderContactLine,
  deliveryMessage,
} from '../../supabase/functions/_shared/orderTracking.ts';

const enforced = { ...STATUS_ALLOWANCE_DEFAULTS, billingMode: 'enforced' as const, unitCostNgn: 20 };

describe('status message allowance', () => {
  it('uses distinct, de-duplicated states per fulfilment type', () => {
    expect(new Set(DELIVERY_STATUS_MESSAGE_STATES).size).toBe(DELIVERY_STATUS_MESSAGE_STATES.length);
    expect(new Set(PICKUP_STATUS_MESSAGE_STATES).size).toBe(PICKUP_STATUS_MESSAGE_STATES.length);
    for (const s of RIDER_STATUS_MESSAGE_STATES) {
      expect(PICKUP_STATUS_MESSAGE_STATES).not.toContain(s);
      expect(DELIVERY_STATUS_MESSAGE_STATES).toContain(s);
    }
  });

  it('normalizes carryout spellings to pickup', () => {
    for (const v of ['pickup', 'self_pickup', 'carryout', 'takeaway']) {
      expect(normalizeStatusFulfilment(v)).toBe('pickup');
    }
    expect(normalizeStatusFulfilment('delivery')).toBe('delivery');
    expect(normalizeStatusFulfilment(undefined)).toBe('delivery');
    expect(expectedStatusStates('pickup')).toEqual([...PICKUP_STATUS_MESSAGE_STATES]);
  });

  it('includes the delivery estimate once with a full snapshot when enforced', () => {
    const est = computeStatusAllowance({ fulfilmentType: 'delivery', cfg: enforced, fxUsdNgn: 1600 });
    expect(est.expectedCount).toBe(DELIVERY_STATUS_MESSAGE_STATES.length);
    expect(est.unitCostKobo).toBe(2000);
    expect(est.estimatedProviderCostKobo).toBe(2000 * est.expectedCount);
    expect(est.amountIncludedKobo).toBe(est.estimatedProviderCostKobo + est.markupKobo);
    expect(est.snapshot.expected_count).toBe(est.expectedCount);
    expect(est.snapshot.unit_cost_kobo).toBe(2000);
    expect(est.snapshot.settings_version).toBe(enforced.settingsVersion);
    expect(est.snapshot.amount_included_in_service_fee_kobo).toBe(est.amountIncludedKobo);
  });

  it('charges carryout its own smaller count with no rider states', () => {
    const pickup = computeStatusAllowance({ fulfilmentType: 'carryout', cfg: enforced, fxUsdNgn: 1600 });
    const delivery = computeStatusAllowance({ fulfilmentType: 'delivery', cfg: enforced, fxUsdNgn: 1600 });
    expect(pickup.expectedCount).toBeLessThan(delivery.expectedCount);
    expect(pickup.amountIncludedKobo).toBeLessThan(delivery.amountIncludedKobo);
    for (const s of RIDER_STATUS_MESSAGE_STATES) expect(pickup.states).not.toContain(s);
  });

  it('records the estimate but bills zero in shadow mode', () => {
    const shadow = computeStatusAllowance({ fulfilmentType: 'delivery', cfg: STATUS_ALLOWANCE_DEFAULTS, fxUsdNgn: 1600 });
    expect(shadow.billingMode).toBe('shadow');
    expect(shadow.estimatedProviderCostKobo).toBeGreaterThan(0);
    expect(shadow.amountIncludedKobo).toBe(0);
  });

  it('bills nothing when disabled', () => {
    const off = computeStatusAllowance({
      fulfilmentType: 'delivery', cfg: { ...enforced, enabled: false }, fxUsdNgn: 1600,
    });
    expect(off.amountIncludedKobo).toBe(0);
  });

  it('falls back to the USD rate and FX buffer when no naira rate is set', () => {
    const est = computeStatusAllowance({
      fulfilmentType: 'delivery',
      cfg: { ...enforced, unitCostNgn: 0, unitCostUsd: 0.005 },
      fxUsdNgn: 1600,
      fxBufferPct: 0,
    });
    expect(est.unitCostKobo).toBe(800);
  });

  it('applies percentage and fixed markup deterministically', () => {
    const est = computeStatusAllowance({
      fulfilmentType: 'delivery',
      cfg: { ...enforced, markupPct: 50, fixedMarkupNgn: 10 },
      fxUsdNgn: 1600,
    });
    const provider = 2000 * est.expectedCount;
    expect(est.markupKobo).toBe(Math.round(provider * 0.5) + 1000);
    expect(est.amountIncludedKobo).toBe(provider + est.markupKobo);
  });

  it('reports variance between the upfront estimate and actual cost', () => {
    const profit = statusCostVariance({
      estimatedRevenueKobo: 5000, estimatedProviderCostKobo: 4000, actualProviderCostKobo: 3800,
    });
    expect(profit.profitKobo).toBe(1200);
    const loss = statusCostVariance({
      estimatedRevenueKobo: 3000, estimatedProviderCostKobo: 4000, actualProviderCostKobo: 3800,
    });
    expect(loss.profitKobo).toBe(-800);
  });

  it('parses admin settings and keeps defaults for missing keys', () => {
    const cfg = parseStatusAllowanceConfig([
      { key: 'whatsapp_status_billing_mode', value: 'enforced' },
      { key: 'whatsapp_status_unit_cost_ngn', value: '25' },
      { key: 'whatsapp_status_expected_count_pickup', value: '3' },
    ]);
    expect(cfg.billingMode).toBe('enforced');
    expect(cfg.unitCostNgn).toBe(25);
    expect(cfg.expectedCountPickup).toBe(3);
    expect(cfg.enabled).toBe(STATUS_ALLOWANCE_DEFAULTS.enabled);
    expect(cfg.markupPct).toBe(STATUS_ALLOWANCE_DEFAULTS.markupPct);
  });
});

describe('rider contact in the assignment message', () => {
  const order = { order_number: 'FC-TEST-0001', delivery_type: 'delivery', tracking_token: 'tok', rider_id: 'rider-1' };
  const snapshot = { rider: { first_name: 'Musa', vehicle_type: 'bike' } };
  const assignEvent = { event_key: 'assigned:rider-1', status: 'assigned', rider_id: 'rider-1' };
  const contact = { name: 'Musa A.', phone: '08031234567', phoneVerified: true, vehicleType: 'bike' };

  it('formats a Nigerian number callably', () => {
    expect(formatCallablePhone('08031234567')).toBe('+234 803 123 4567');
    expect(formatCallablePhone('+2348031234567')).toBe('+234 803 123 4567');
    expect(formatCallablePhone('')).toBeNull();
    expect(formatCallablePhone(null)).toBeNull();
    expect(formatCallablePhone('123')).toBeNull();
  });

  it('includes the rider name and number for a confirmed assignment', () => {
    const msg = deliveryMessage(assignEvent, order, snapshot, contact)!;
    expect(msg).toContain('Musa A.');
    expect(msg).toContain('+234 803 123 4567');
  });

  it('falls back to a support message when there is no verified number', () => {
    const msg = deliveryMessage(assignEvent, order, snapshot, { name: 'Musa A.', phone: null, phoneVerified: false })!;
    expect(msg).toContain('support team can help');
    expect(msg).not.toContain('undefined');
    expect(msg).not.toMatch(/\+234 \d/);
  });

  it('never prints undefined or internal ids when the contact is empty', () => {
    const line = riderContactLine({});
    expect(line).not.toContain('undefined');
    expect(line).not.toContain('rider-1');
    expect(line).toContain('Your rider');
  });

  it('does not expose a number before assignment', () => {
    const msg = deliveryMessage({ event_key: 'preparing:1', status: 'preparing' }, order, snapshot, contact)!;
    expect(msg).not.toContain('+234 803 123 4567');
  });

  it('does not expose a number for a rider no longer assigned to the order', () => {
    const reassigned = { ...order, rider_id: 'rider-2' };
    const msg = deliveryMessage(assignEvent, reassigned, snapshot, contact)!;
    expect(msg).not.toContain('+234 803 123 4567');
  });

  it('sends the new rider contact on reassignment', () => {
    const event2 = { event_key: 'assigned:rider-2', status: 'assigned', rider_id: 'rider-2' };
    const order2 = { ...order, rider_id: 'rider-2' };
    const msg = deliveryMessage(event2, order2, snapshot, { name: 'Bola', phone: '08099998888', phoneVerified: true })!;
    expect(msg).toContain('+234 809 999 8888');
    expect(msg).not.toContain('+234 803 123 4567');
  });

  it('produces the same message for a replayed assignment event (idempotent content)', () => {
    const a = deliveryMessage(assignEvent, order, snapshot, contact);
    const b = deliveryMessage(assignEvent, order, snapshot, contact);
    expect(a).toBe(b);
  });

  it('sends nothing for carryout orders', () => {
    expect(deliveryMessage(assignEvent, { ...order, delivery_type: 'self_pickup' }, snapshot, contact)).toBeNull();
  });
});
