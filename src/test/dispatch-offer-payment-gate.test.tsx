import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDispatchOffers } from '@/hooks/useDispatchOffers';
import { resetRiderOfferStore } from '@/hooks/riderOfferStore';

/**
 * Discovery is now server-authoritative: the rider app calls
 * get_my_rider_offers(), which applies the paid-only gate inside the database
 * where the private dispatch_requests/orders rows are readable. These tests
 * drive the hook through a faked RPC and assert that the app shows exactly what
 * the server allowed, never reads tables directly, and never treats a realtime
 * payload as proof. No table reads, no writes, no production side effects.
 */

const mock = vi.hoisted(() => ({
  user: { id: 'rider' } as { id: string } | null,
  payload: null as unknown,
  error: null as unknown,
  listener: null as null | ((payload: unknown) => void),
}));

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: mock.user }) }));
vi.mock('@/hooks/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: async (name: string) => {
      if (name !== 'get_my_rider_offers') throw new Error(`Unexpected rpc ${name}`);
      return { data: mock.payload, error: mock.error };
    },
    from: () => {
      throw new Error('The rider app must not read dispatch tables directly');
    },
    channel: () => {
      const channel: any = {
        on: (_event: unknown, _filter: unknown, listener: typeof mock.listener) => {
          mock.listener = listener;
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: vi.fn(),
    auth: { getSession: async () => ({ data: { session: null } }) },
    functions: { invoke: async () => ({ data: { success: false }, error: null }) },
  },
}));

const baseOffer = {
  id: 'offer',
  dispatch_request_id: 'request',
  rider_user_id: 'rider',
  rider_profile_id: 'profile',
  order_id: 'order',
  order_number: 'FC-TEST-0001',
  status: 'pending',
  expires_at: '2099-01-01T00:00:00Z',
  created_at: '2026-09-17T14:31:00Z',
  distance_km: 1,
  delivery_fee: 1000,
  rider_share: 700,
  priority_tier: 'platform_riders',
};

function payload(over: Record<string, unknown> = {}) {
  return {
    ok: true,
    reason: null,
    offers: [],
    excluded: [],
    server_time: '2026-09-17T14:32:00Z',
    active_order_count: 0,
    max_concurrent_orders: 1,
    ...over,
  };
}

async function renderOffers() {
  const rendered = renderHook(() => useDispatchOffers());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
  return rendered;
}

describe('rider offer payment discovery', () => {
  beforeEach(() => {
    mock.user = { id: 'rider' };
    mock.payload = payload();
    mock.error = null;
    mock.listener = null;
  });

  it.each([
    // An ordinary rider sees a paid online order even though the linked
    // dispatch_request/order rows are not readable by riders.
    ['a paid online order', payload({ offers: [baseOffer] }), 1],
    // Unpaid online / WhatsApp orders are excluded server-side.
    ['an unpaid online order', payload({ excluded: [{ offer_id: 'offer', reason: 'ORDER_NOT_PAID' }] }), 0],
    // Authorised POS / assisted semantics keep working.
    ['an authorised POS order', payload({ offers: [{ ...baseOffer, id: 'pos' }] }), 1],
    ['an authorised assisted order', payload({ offers: [{ ...baseOffer, id: 'assisted' }] }), 1],
    // Expired, rejected, accepted, reassigned, cancelled and refunded are hidden.
    ['an expired offer', payload({ excluded: [{ offer_id: 'offer', reason: 'OFFER_EXPIRED' }] }), 0],
    ['an already answered offer', payload({ excluded: [{ offer_id: 'offer', reason: 'OFFER_NOT_PENDING' }] }), 0],
    ['an order taken by another rider', payload({ excluded: [{ offer_id: 'offer', reason: 'ORDER_ASSIGNED_ELSEWHERE' }] }), 0],
    ['a cancelled order', payload({ excluded: [{ offer_id: 'offer', reason: 'ORDER_CLOSED' }] }), 0],
    ['a superseded duplicate order', payload({ excluded: [{ offer_id: 'offer', reason: 'ORDER_SUPERSEDED' }] }), 0],
    ['a refunded order', payload({ excluded: [{ offer_id: 'offer', reason: 'ORDER_REFUNDED' }] }), 0],
  ])('shows %s correctly', async (_label, given, count) => {
    mock.payload = given;
    const { result, unmount } = await renderOffers();
    expect(result.current.loading).toBe(false);
    expect(result.current.ok).toBe(true);
    expect(result.current.offers).toHaveLength(count as number);
    expect(result.current.pendingCount).toBe(count as number);
    unmount();
  });

  it('is identical for an admin rider and an ordinary rider', async () => {
    mock.payload = payload({ offers: [baseOffer] });
    const ordinary = await renderOffers();
    const ordinaryCount = ordinary.result.current.pendingCount;
    ordinary.unmount();

    // Same server response for a rider who also happens to be an admin.
    mock.user = { id: 'admin-rider' };
    const admin = await renderOffers();
    expect(admin.result.current.pendingCount).toBe(ordinaryCount);
    admin.unmount();
  });

  it('shows nothing when the offer belongs to a different rider', async () => {
    // The server derives auth.uid() itself and returns no offers for a rider
    // who was not offered the job.
    mock.payload = payload({ offers: [] });
    const { result, unmount } = await renderOffers();
    expect(result.current.offers).toEqual([]);
    expect(result.current.ok).toBe(true);
    unmount();
  });

  it('reports a failed lookup as an error, not as "no orders"', async () => {
    mock.error = { message: 'lookup denied' };
    mock.payload = null;
    const { result, unmount } = await renderOffers();
    expect(result.current.loading).toBe(false);
    expect(result.current.ok).toBe(false);
    expect(result.current.error).toBeTruthy();
    expect(result.current.offers).toEqual([]);
    unmount();
  });

  it('does not trust realtime insert payloads as payment proof', async () => {
    const { result, unmount } = await renderOffers();
    expect(result.current.loading).toBe(false);
    await act(async () =>
      mock.listener?.({
        eventType: 'INSERT',
        new: { id: 'unpaid', rider_user_id: 'rider', status: 'pending', expires_at: '2099-01-01' },
      }),
    );
    expect(result.current.offers).toEqual([]);
    unmount();
  });
});
