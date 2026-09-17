import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  EMPTY_DISCOVERY,
  RIDER_ACTIVE_ORDER_STATUSES,
  discoveryError,
  parseOfferDiscovery,
  pruneExpiredOffers,
  type RiderOffer,
} from '@/lib/riderOffers';
import {
  resolveDestination,
  isValidCoordinate,
} from '../../supabase/functions/_shared/dispatchDestination';
import { RIDER_ACTIVE_ORDER_STATUSES as EDGE_ACTIVE_STATUSES } from '../../supabase/functions/_shared/riderCapacity';

// ---------------------------------------------------------------------------
// A single shared fake of the secure RPC. No table reads, no writes, no network:
// these tests can never touch production orders, payments or wallets.
// ---------------------------------------------------------------------------
const rpcMock = vi.fn();
const removeChannelMock = vi.fn();
let channelHandler: ((payload: unknown) => void) | null = null;

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    removeChannel: (...args: unknown[]) => removeChannelMock(...args),
    channel: () => {
      const chan: any = {
        on: (_event: string, _filter: unknown, handler: (p: unknown) => void) => {
          channelHandler = handler;
          return chan;
        },
        subscribe: () => chan,
      };
      return chan;
    },
    from: () => {
      throw new Error('Tests must never read or write tables directly');
    },
  },
}));

function offer(over: Partial<RiderOffer> = {}): RiderOffer {
  return {
    id: over.id ?? 'offer-1',
    dispatch_request_id: 'req-1',
    rider_user_id: 'rider-1',
    rider_profile_id: 'profile-1',
    order_id: 'order-1',
    order_number: 'FC-260917-6011',
    distance_km: 0.14,
    delivery_distance_km: 2.5,
    delivery_fee: 1200,
    rider_share: 550,
    priority_tier: 'platform_riders',
    vendor_name: 'Test Kitchen',
    vendor_address: 'Pickup street',
    customer_address: 'Destination street',
    delivery_instructions: null,
    pickup_latitude: 6.5,
    pickup_longitude: 3.3,
    destination_latitude: 6.52,
    destination_longitude: 3.32,
    estimated_pickup_minutes: 5,
    estimated_delivery_minutes: 15,
    status: 'pending',
    created_at: '2026-09-17T14:31:00Z',
    expires_at: '2026-09-17T14:36:00Z',
    responded_at: null,
    platform_fee: 300,
    distance_bonus: 0,
    time_surge_bonus: 0,
    weather_surge_bonus: 0,
    total_surge_bonus: 0,
    subsidy_amount: 0,
    weather_condition: 'clear',
    time_period: 'afternoon',
    ...over,
  };
}

function serverPayload(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    reason: null,
    offers: [offer()],
    excluded: [],
    server_time: '2026-09-17T14:32:00Z',
    active_order_count: 0,
    max_concurrent_orders: 1,
    ...over,
  };
}

describe('rider offer payload parsing', () => {
  it('accepts the server payload and keeps the server clock', () => {
    const parsed = parseOfferDiscovery(serverPayload());
    expect(parsed.ok).toBe(true);
    expect(parsed.offers).toHaveLength(1);
    expect(parsed.offers[0].order_number).toBe('FC-260917-6011');
    expect(parsed.serverTime).toBe('2026-09-17T14:32:00Z');
    expect(parsed.errorMessage).toBeNull();
  });

  it('surfaces an unusable payload as an error, never as an empty list', () => {
    for (const bad of [null, undefined, 'nope', 42, [], {}]) {
      const parsed = parseOfferDiscovery(bad);
      expect(parsed.ok).toBe(false);
      expect(parsed.errorMessage).toBeTruthy();
      expect(parsed.offers).toEqual([]);
    }
  });

  it('treats a not-authenticated response as an error state', () => {
    const parsed = parseOfferDiscovery({ ok: false, reason: 'NOT_AUTHENTICATED', offers: [] });
    expect(parsed.ok).toBe(false);
    expect(parsed.reason).toBe('NOT_AUTHENTICATED');
  });

  it('passes through server exclusion reasons for diagnostics without other orders', () => {
    const parsed = parseOfferDiscovery(
      serverPayload({
        offers: [],
        excluded: [
          { offer_id: 'o1', reason: 'ORDER_NOT_PAID' },
          { offer_id: 'o2', reason: 'OFFER_EXPIRED' },
          { offer_id: 'o3', reason: 'ORDER_ASSIGNED_ELSEWHERE' },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    expect(parsed.offers).toEqual([]);
    expect(parsed.excluded.map((e) => e.reason)).toEqual([
      'ORDER_NOT_PAID',
      'OFFER_EXPIRED',
      'ORDER_ASSIGNED_ELSEWHERE',
    ]);
    // No customer or order payload leaks through an exclusion entry.
    expect(Object.keys(parsed.excluded[0]).sort()).toEqual(['offer_id', 'reason']);
  });

  it('reports server skip reasons (offline / capacity / not approved) as a successful lookup', () => {
    for (const reason of ['RIDER_OFFLINE', 'RIDER_AT_CAPACITY', 'RIDER_NOT_APPROVED']) {
      const parsed = parseOfferDiscovery(serverPayload({ offers: [], reason }));
      expect(parsed.ok).toBe(true);
      expect(parsed.reason).toBe(reason);
      expect(parsed.errorMessage).toBeNull();
    }
  });

  it('discoveryError never claims an empty list', () => {
    const err = discoveryError('boom');
    expect(err.ok).toBe(false);
    expect(err.offers).toEqual([]);
    expect(EMPTY_DISCOVERY.ok).toBe(true);
  });
});

describe('server-time expiry (device clock skew)', () => {
  const offers = [offer({ id: 'live', expires_at: '2026-09-17T14:36:00Z' })];
  const serverTime = '2026-09-17T14:32:00Z';

  it('keeps an offer when the device clock runs hours fast', () => {
    const fetchedAt = 1_000_000;
    const deviceNow = fetchedAt + 1000; // 1s elapsed locally
    const kept = pruneExpiredOffers(offers, serverTime, fetchedAt, deviceNow);
    expect(kept).toHaveLength(1);
  });

  it('drops the offer once the server clock has genuinely passed expiry', () => {
    const fetchedAt = 1_000_000;
    const deviceNow = fetchedAt + 5 * 60 * 1000; // 5 minutes elapsed
    expect(pruneExpiredOffers(offers, serverTime, fetchedAt, deviceNow)).toHaveLength(0);
  });

  it('falls back to local time only when the server gave no clock', () => {
    const past = [offer({ expires_at: '2000-01-01T00:00:00Z' })];
    expect(pruneExpiredOffers(past, null, 0, Date.now())).toHaveLength(0);
  });
});

describe('destination coordinate resolution', () => {
  it('uses the order inline coordinates when there is no saved address id', () => {
    const res = resolveDestination({ orderLatitude: 6.52, orderLongitude: 3.32 });
    expect(res.ok).toBe(true);
    expect(res.source).toBe('order_inline');
    expect(res.latitude).toBe(6.52);
  });

  it('prefers the order inline coordinates over the saved address', () => {
    const res = resolveDestination({
      orderLatitude: 6.52,
      orderLongitude: 3.32,
      addressLatitude: 7.1,
      addressLongitude: 3.9,
    });
    expect(res.source).toBe('order_inline');
    expect(res.longitude).toBe(3.32);
  });

  it('falls back to the linked saved address', () => {
    const res = resolveDestination({ addressLatitude: 7.1, addressLongitude: 3.9 });
    expect(res.source).toBe('saved_address');
    expect(res.ok).toBe(true);
  });

  it('fails explicitly instead of recording 0 km / 0,0', () => {
    for (const input of [
      {},
      { orderLatitude: 0, orderLongitude: 0 },
      { orderLatitude: null, orderLongitude: null, addressLatitude: 0, addressLongitude: 0 },
      { orderLatitude: 999, orderLongitude: 3.3 },
      { orderLatitude: 'abc', orderLongitude: 'def' },
    ]) {
      const res = resolveDestination(input as any);
      expect(res.ok).toBe(false);
      expect(res.error).toBe('MISSING_DESTINATION_COORDINATES');
      expect(res.latitude).toBeNull();
      expect(res.longitude).toBeNull();
    }
  });

  it('validates coordinate ranges', () => {
    expect(isValidCoordinate(6.5, 3.3)).toBe(true);
    expect(isValidCoordinate(0, 0)).toBe(false);
    expect(isValidCoordinate(91, 3.3)).toBe(false);
    expect(isValidCoordinate(6.5, 181)).toBe(false);
    expect(isValidCoordinate(NaN, 3.3)).toBe(false);
  });
});

describe('rider capacity statuses', () => {
  it('is one authoritative set that includes on_the_way', () => {
    expect([...RIDER_ACTIVE_ORDER_STATUSES]).toEqual(['assigned', 'picked_up', 'on_the_way']);
    expect([...EDGE_ACTIVE_STATUSES]).toEqual([...RIDER_ACTIVE_ORDER_STATUSES]);
  });

  it('does not count completed or cancelled work against a rider', () => {
    for (const status of ['delivered', 'cancelled', 'pending', 'confirmed', 'preparing']) {
      expect(RIDER_ACTIVE_ORDER_STATUSES as readonly string[]).not.toContain(status);
    }
  });
});

describe('shared rider offer store', () => {
  let store: typeof import('@/hooks/riderOfferStore');

  beforeEach(async () => {
    vi.resetModules();
    rpcMock.mockReset();
    removeChannelMock.mockReset();
    channelHandler = null;
    store = await import('@/hooks/riderOfferStore');
  });

  afterEach(() => {
    store.bindRiderOfferStore(null);
    vi.useRealTimers();
  });

  it('reads only the secure RPC and never a table', async () => {
    rpcMock.mockResolvedValue({ data: serverPayload(), error: null });
    store.bindRiderOfferStore('rider-1');
    await store.fetchRiderOffers();
    expect(rpcMock).toHaveBeenCalledWith('get_my_rider_offers');
    // The mocked client throws if .from() is ever used.
  });

  it('gives the page and the badge the exact same count', async () => {
    rpcMock.mockResolvedValue({
      data: serverPayload({ offers: [offer({ id: 'a' }), offer({ id: 'b' })] }),
      error: null,
    });
    store.bindRiderOfferStore('rider-1');
    await store.fetchRiderOffers();

    const seen: number[] = [];
    const unsub1 = store.subscribeRiderOffers((s) => seen.push(s.offers.length));
    const unsub2 = store.subscribeRiderOffers((s) => seen.push(s.offers.length));
    await store.fetchRiderOffers();
    unsub1();
    unsub2();

    expect(store.getRiderOfferState().offers).toHaveLength(2);
    expect(new Set(seen).size).toBe(1); // every consumer saw the same number
  });

  it('shows an RPC failure as an error, not as "no orders"', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'permission denied' } });
    store.bindRiderOfferStore('rider-1');
    await store.fetchRiderOffers();
    const state = store.getRiderOfferState();
    expect(state.ok).toBe(false);
    expect(state.errorMessage).toBeTruthy();
    expect(state.offers).toEqual([]);
  });

  it('refetches on a realtime event instead of injecting the payload', async () => {
    rpcMock.mockResolvedValue({ data: serverPayload({ offers: [] }), error: null });
    store.bindRiderOfferStore('rider-1');
    await store.fetchRiderOffers();
    const before = rpcMock.mock.calls.length;

    channelHandler?.({
      eventType: 'INSERT',
      new: { id: 'forged', rider_user_id: 'rider-1', status: 'pending' },
    });
    await Promise.resolve();
    await store.fetchRiderOffers();

    expect(rpcMock.mock.calls.length).toBeGreaterThan(before);
    // The forged realtime row never became an offer.
    expect(store.getRiderOfferState().offers).toEqual([]);
  });

  it('refetches on focus, visibility resume and reconnect', async () => {
    rpcMock.mockResolvedValue({ data: serverPayload(), error: null });
    store.bindRiderOfferStore('rider-1');
    await store.fetchRiderOffers();

    const before = rpcMock.mock.calls.length;
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
    await store.fetchRiderOffers();
    expect(rpcMock.mock.calls.length).toBeGreaterThan(before);
  });

  it('polls while bound so a missed realtime event recovers', async () => {
    vi.useFakeTimers();
    rpcMock.mockResolvedValue({ data: serverPayload(), error: null });
    store.bindRiderOfferStore('rider-1');
    const before = rpcMock.mock.calls.length;
    await vi.advanceTimersByTimeAsync(21000);
    expect(rpcMock.mock.calls.length).toBeGreaterThan(before);
  });

  it('coalesces concurrent lookups so a rider is not double-notified', async () => {
    let resolveRpc: (v: unknown) => void = () => {};
    rpcMock.mockImplementation(
      () => new Promise((resolve) => { resolveRpc = resolve; }),
    );
    store.bindRiderOfferStore('rider-1');
    const a = store.fetchRiderOffers();
    const b = store.fetchRiderOffers();
    resolveRpc({ data: serverPayload(), error: null });
    await Promise.all([a, b]);
    expect(rpcMock.mock.calls.length).toBe(1);
  });

  it('clears everything when the rider signs out', async () => {
    rpcMock.mockResolvedValue({ data: serverPayload(), error: null });
    store.bindRiderOfferStore('rider-1');
    await store.fetchRiderOffers();
    expect(store.getRiderOfferState().offers).toHaveLength(1);
    store.bindRiderOfferStore(null);
    expect(store.getRiderOfferState().offers).toEqual([]);
    expect(removeChannelMock).toHaveBeenCalled();
  });
});
