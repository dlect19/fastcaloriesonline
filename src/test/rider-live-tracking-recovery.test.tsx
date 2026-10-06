import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { liveState, DEFAULT_TRACKING_CONFIG as C, CONNECT_WINDOW_MS, isUsableFix, ACTIVE_TRACKING_STATUSES } from '@/lib/riderTracking';

const rpc = vi.fn();
const removeChannel = vi.fn();
let orderRows: { id: string; status: string }[] = [];
let orderChangeCb: (() => void) | null = null;
const eqCalls: [string, string][] = [];

vi.mock('@/integrations/supabase/client', () => {
  const ordersQuery: any = {
    select: () => ordersQuery,
    eq: (k: string, v: string) => { eqCalls.push([k, v]); return ordersQuery; },
    in: () => ordersQuery,
    limit: () => Promise.resolve({ data: orderRows }),
    then: undefined,
  };
  const settings: any = { select: () => settings, in: () => Promise.resolve({ data: [] }) };
  return {
    supabase: {
      from: (t: string) => (t === 'orders' ? ordersQuery : settings),
      rpc: (...a: any[]) => rpc(...a),
      channel: () => {
        const ch: any = { on: (_e: string, _f: any, cb: () => void) => { orderChangeCb = cb; return ch; }, subscribe: () => ch };
        return ch;
      },
      removeChannel: (...a: any[]) => removeChannel(...a),
    },
  };
});
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: {} }));

import { useRiderLiveTracking, isMissingRpcError } from '@/hooks/useRiderLiveTracking';
import { RiderTrackingStatus } from '@/components/rider/RiderTrackingStatus';

const pos = () => ({ coords: { latitude: 6.5, longitude: 3.4, accuracy: 350, speed: null, heading: null }, timestamp: Date.now() });
let getCurrent: any; let watch: any; let clearWatch: any;

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  removeChannel.mockReset(); orderRows = []; orderChangeCb = null; eqCalls.length = 0;
  getCurrent = vi.fn((ok: any) => ok(pos()));
  watch = vi.fn(() => 7); clearWatch = vi.fn();
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: getCurrent, watchPosition: watch, clearWatch } });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: () => Promise.resolve({ state: 'prompt' }) } });
});
afterEach(() => vi.useRealTimers());

describe('FC-261006-6839 regression: assigned order with no location yet', () => {
  it('publishes the first fix immediately, mapped to the auth rider and real order id', async () => {
    orderRows = [{ id: 'order-1', status: 'on_the_way' }];
    const { result } = renderHook(() => useRiderLiveTracking('rider-user'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe('publish_rider_location');
    expect(args.p_order_id).toBe('order-1');
    expect(args).not.toHaveProperty('p_rider_id'); // rider is server-derived from auth
    expect(eqCalls).toContainEqual(['rider_id', 'rider-user']);
    await waitFor(() => expect(result.current.status).toBe('tracking'));
  });

  it('starts as soon as a realtime order change assigns a delivery (no 60 s wait)', async () => {
    const { result } = renderHook(() => useRiderLiveTracking('rider-user'));
    await waitFor(() => expect(orderChangeCb).not.toBeNull());
    expect(rpc).not.toHaveBeenCalled();
    orderRows = [{ id: 'order-2', status: 'assigned' }];
    await act(async () => { orderChangeCb!(); });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(result.current.activeOrderCount).toBe(1);
  });

  it('off-duty rider (no active delivery) never requests GPS or publishes', async () => {
    renderHook(() => useRiderLiveTracking('rider-user'));
    await new Promise((r) => setTimeout(r, 30));
    expect(getCurrent).not.toHaveBeenCalled();
    expect(watch).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('permission denied shows status; retry re-asks and publishes', async () => {
    orderRows = [{ id: 'order-1', status: 'picked_up' }];
    getCurrent.mockImplementationOnce((_ok: any, err: any) => err({ code: 1 }));
    const { result } = renderHook(() => useRiderLiveTracking('rider-user'));
    await waitFor(() => expect(result.current.status).toBe('permission_denied'));
    expect(rpc).not.toHaveBeenCalled();
    await act(async () => { result.current.retry(); });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
  });

  it('missing RPC surfaces "update required"', async () => {
    expect(isMissingRpcError({ code: 'PGRST202' })).toBe(true);
    orderRows = [{ id: 'order-1', status: 'assigned' }];
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    const { result } = renderHook(() => useRiderLiveTracking('rider-user'));
    await waitFor(() => expect(result.current.status).toBe('update_required'));
  });

  it('cleans up watcher and realtime channel on unmount', async () => {
    orderRows = [{ id: 'order-1', status: 'assigned' }];
    const { unmount } = renderHook(() => useRiderLiveTracking('rider-user'));
    await waitFor(() => expect(watch).toHaveBeenCalled());
    unmount();
    expect(clearWatch).toHaveBeenCalledWith(7);
    expect(removeChannel).toHaveBeenCalled();
  });

  it('rider banner offers Retry when permission is needed', () => {
    const onRetry = vi.fn();
    render(<RiderTrackingStatus status="permission_denied" activeOrderCount={1} onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
    const { container } = render(<RiderTrackingStatus status="tracking" activeOrderCount={0} onRetry={onRetry} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('customer bounded waiting and recovery', () => {
  it('connecting → waiting after a short window, live once the first point arrives', () => {
    const now = Date.now();
    expect(liveState(null, now, C, CONNECT_WINDOW_MS - 1)).toBe('connecting');
    expect(liveState(null, now, C, CONNECT_WINDOW_MS + 1)).toBe('waiting');
    expect(liveState(new Date(now).toISOString(), now, C, 600_000)).toBe('live');
    expect(CONNECT_WINDOW_MS).toBeLessThanOrEqual(30_000);
  });
  it('coarse phone fixes are accepted up to the server limit', () => {
    expect(isUsableFix({ lat: 6.5, lng: 3.4, accuracy: 400, capturedAt: Date.now() }, Date.now())).toBe(true);
  });
  it('eligibility matches real statuses assigned → on_the_way', () => {
    expect([...ACTIVE_TRACKING_STATUSES]).toEqual(['assigned', 'picked_up', 'on_the_way']);
  });
});

describe('order detail placement and isolation', () => {
  const page = readFileSync('src/pages/OrderDetail.tsx', 'utf8');
  const map = readFileSync('src/components/order/LiveRiderMap.tsx', 'utf8');
  it('renders the map once, directly in main before the Order Status card', () => {
    expect(page.match(/<LiveRiderMap /g)?.length).toBe(1);
    const mainIdx = page.indexOf('<main');
    const mapIdx = page.indexOf('<LiveRiderMap ');
    expect(mapIdx).toBeGreaterThan(mainIdx);
    expect(mapIdx).toBeLessThan(page.indexOf('Payment Pending'));
    expect(mapIdx).toBeLessThan(page.indexOf('Order Status</CardTitle>'));
  });
  it('customer map reads only its order and never calls Google routing per point', () => {
    expect(map).toMatch(/filter: `order_id=eq\.\$\{orderId\}`/);
    expect(map).not.toMatch(/DirectionsService|DistanceMatrix|computeRoutes/);
    expect(map).toMatch(/Waiting for rider to enable location/);
  });
});
