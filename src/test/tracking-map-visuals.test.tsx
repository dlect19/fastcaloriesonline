import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { bearingDeg, chooseRiderHeading, newerLocation, projectOntoPath, quantizeHeading, remainingRoute, resubscribeDelayMs, shouldPoll, ROUTE_MOVE_M, decodePolyline, distanceToPathM, etaLabel, mapPoint, routeBackoffMs, shouldFitTrackingMap, shouldRefreshRoute, trackingDistanceLabel, trackingMarkerSvg } from '@/lib/trackingMapVisuals';
import { isUnsupportedTwoWheeler, parseComputeRoutes, routeCacheKey, computeRoutesBody } from '../../supabase/functions/_shared/rider-route-core';

const mocks = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, change: null as ((p: any) => void) | null, remove: vi.fn(), eq: vi.fn(), invoke: vi.fn() }));
// Do not load Google Maps or make any external requests during unit checks.
vi.mock('@/lib/googleMapsLoader', () => ({ loadGoogleMapsJs: () => new Promise<void>(() => {}) }));
vi.mock('@/hooks/useTrackingConfig', async () => {
  const { DEFAULT_TRACKING_CONFIG } = await import('@/lib/riderTracking');
  return { useTrackingConfig: () => DEFAULT_TRACKING_CONFIG };
});
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  from: () => ({ select: () => ({ eq: (...a: unknown[]) => { mocks.eq(...a); return { maybeSingle: async () => ({ data: mocks.row }) }; } }) }),
  channel: () => { const channel = { on: (_: unknown, __: unknown, cb: (p: any) => void) => { mocks.change = cb; return channel; }, subscribe: () => channel }; return channel; },
  removeChannel: mocks.remove,
  functions: { invoke: mocks.invoke },
} }));
import { LiveRiderMap } from '@/components/order/LiveRiderMap';

beforeEach(() => { mocks.row = null; mocks.change = null; mocks.remove.mockClear(); mocks.eq.mockClear(); mocks.invoke.mockReset(); mocks.invoke.mockResolvedValue({ data: { ok: true, distance_m: 1450, duration_s: 300, polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@', origin_received_at: new Date().toISOString() }, error: null }); });

describe('local tracking map artwork and geometry', () => {
  it('renders distinct motorcycle and house SVG artwork, never a red pin', () => {
    const rider = decodeURIComponent(trackingMarkerSvg('rider', 'green', 'white').split(',')[1]);
    const home = decodeURIComponent(trackingMarkerSvg('delivery', 'orange', 'white').split(',')[1]);
    expect(rider).toContain('data-part="helmet"');
    expect(rider).toContain('data-part="front-tyre"');
    expect(rider).toContain('data-part="halo"');
    expect(rider).not.toMatch(/<circle cx="34" cy="32" r="29"/); // no longer a tiny motorcycle-in-pin
    expect(home).toContain('15-13');
    expect(rider).not.toEqual(home);
    expect(rider).toContain('stroke="white"');
  });
  it('formats metres below 1 km and kilometres above it', () => {
    expect(trackingDistanceLabel(14.2)).toBe('14 m');
    expect(trackingDistanceLabel(0)).toBe('0 m');
    expect(trackingDistanceLabel(999)).toBe('999 m');
    expect(trackingDistanceLabel(1000)).toBe('1.0 km');
    expect(trackingDistanceLabel(1450)).toBe('1.4 km');
  });
  it('accepts zero coordinates and rejects missing or invalid pairs', () => {
    expect(mapPoint(0, 0)).toEqual({ lat: 0, lng: 0 });
    expect(mapPoint(null, 3)).toBeNull();
    expect(mapPoint(3, undefined)).toBeNull();
    expect(mapPoint(NaN, 3)).toBeNull();
    expect(mapPoint(91, 3)).toBeNull();
  });
  it('fits initially, ignores jitter and frequent movement, and preserves user camera interaction', () => {
    const first = { lat: 6, lng: 3 };
    const moved = { lat: 6.01, lng: 3 };
    expect(shouldFitTrackingMap(null, first, 0, false, true)).toBe(true);
    expect(shouldFitTrackingMap(first, { lat: 6.0001, lng: 3 }, 30_000, false, true)).toBe(false);
    expect(shouldFitTrackingMap(first, moved, 1000, false, true)).toBe(false);
    expect(shouldFitTrackingMap(first, moved, 30_000, false, true)).toBe(true);
    expect(shouldFitTrackingMap(first, moved, 30_000, false, false)).toBe(false);
    expect(shouldFitTrackingMap(null, moved, 30_000, true, true)).toBe(false);
  });
  it('draws only returned road geometry: no direct line, no browser routing APIs', () => {
    const src = readFileSync('src/components/order/LiveRiderMap.tsx', 'utf8');
    expect(src).toContain('new google.maps.Polyline');
    expect(src).toContain("setPath(remaining.path)");
    expect(src).not.toContain('setPath([p, destination])');
    expect(src).not.toMatch(/geodesic|direct distance|\(direct\)/i);
    expect(src).not.toMatch(/DirectionsService|DistanceMatrix|Geocoder|fetch\(/);
    expect(src).toContain("functions.invoke('customer-rider-route'");
    expect(src).not.toMatch(/styles:|styledMapType/);
  });
});

describe('road route helpers', () => {
  it('decodes Google encoded polylines', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]);
  });
  it('refreshes initially and on meaningful movement/deviation only, throttled', () => {
    const path = [{ lat: 6, lng: 3 }, { lat: 6.01, lng: 3 }];
    const base = { routeOrigin: path[0], path, lastRequestAt: 0, now: 100_000, routeAt: 90_000 };
    expect(shouldRefreshRoute({ ...base, rider: path[0], routeOrigin: null, path: null })).toBe(true);
    expect(shouldRefreshRoute({ ...base, rider: { lat: 6.0003, lng: 3 } })).toBe(false); // small move along route
    expect(shouldRefreshRoute({ ...base, rider: { lat: 6.002, lng: 3 } })).toBe(true); // >150 m
    expect(shouldRefreshRoute({ ...base, rider: { lat: 6.0003, lng: 3.001 } })).toBe(true); // ~110 m off route
    expect(shouldRefreshRoute({ ...base, rider: { lat: 6.002, lng: 3 }, lastRequestAt: 95_000 })).toBe(false); // throttle
    expect(distanceToPathM({ lat: 6.005, lng: 3 }, path)).toBeLessThan(1);
  });
  it('backs off with a bound and gives up', () => {
    expect([1, 2, 3, 4, 5].map(routeBackoffMs)).toEqual([5000, 10000, 20000, 40000, 80000]);
    expect(routeBackoffMs(6)).toBeNull();
    expect(etaLabel(30)).toBe('1 min'); expect(etaLabel(4000)).toBe('1 h 7 min');
  });
  it('parses Routes responses strictly and caches by ~55 m cell', () => {
    expect(parseComputeRoutes({ routes: [{ distanceMeters: 900, duration: '125.5s', polyline: { encodedPolyline: 'abc' } }] })).toEqual({ ok: true, distance_m: 900, duration_s: 125.5, polyline: 'abc' });
    expect(parseComputeRoutes({ routes: [{ duration: '0s', polyline: { encodedPolyline: 'a' } }] })).toMatchObject({ ok: true, distance_m: 0 });
    expect(parseComputeRoutes({})).toEqual({ ok: false, reason: 'no_route' });
    expect(parseComputeRoutes({ routes: [{ distanceMeters: 5, duration: '3s' }] })).toEqual({ ok: false, reason: 'malformed' });
    const d = { lat: 6.5, lng: 3.4 };
    expect(routeCacheKey('production', 'o', { lat: 6.50001, lng: 3.30001 }, d)).toBe(routeCacheKey('production', 'o', { lat: 6.50011, lng: 3.29991 }, d));
    expect(routeCacheKey('production', 'o', { lat: 6.5, lng: 3.3 }, d)).not.toBe(routeCacheKey('production', 'o', { lat: 6.502, lng: 3.3 }, d));
    expect(computeRoutesBody({ lat: 1, lng: 2 }, d, 'TWO_WHEELER').travelMode).toBe('TWO_WHEELER');
  });
  it('falls back to DRIVE only when Google rejects TWO_WHEELER as unsupported', () => {
    const err = (status: string, message: string) => JSON.stringify({ error: { code: 400, status, message } });
    expect(isUnsupportedTwoWheeler(400, err('INVALID_ARGUMENT', 'Travel mode TWO_WHEELER is not supported in this region.'))).toBe(true);
    expect(isUnsupportedTwoWheeler(400, err('INVALID_ARGUMENT', 'Invalid origin latitude.'))).toBe(false);
    expect(isUnsupportedTwoWheeler(403, err('PERMISSION_DENIED', 'TWO_WHEELER not supported'))).toBe(false);
    expect(isUnsupportedTwoWheeler(429, err('RESOURCE_EXHAUSTED', 'Quota exceeded'))).toBe(false);
    expect(isUnsupportedTwoWheeler(400, err('FAILED_PRECONDITION', 'Billing not enabled; TWO_WHEELER not supported'))).toBe(false);
    expect(isUnsupportedTwoWheeler(400, err('INVALID_ARGUMENT', 'API key not valid. travel mode not supported'))).toBe(false);
    const src = readFileSync('supabase/functions/customer-rider-route/index.ts', 'utf8');
    expect(src).toMatch(/mode === "TWO_WHEELER" && isUnsupportedTwoWheeler\(res\.status, text\)\) \{[\s\S]*?continue;/);
    expect(src).toContain('for (const mode of ["TWO_WHEELER", "DRIVE"] as const)');
  });
  it('server route endpoint reads origin/destination server-side and is capped and owner-scoped', () => {
    const src = readFileSync('supabase/functions/customer-rider-route/index.ts', 'utf8');
    expect(src).toContain('order.user_id !== guard.userId');
    expect(src).toContain("from(\"rider_live_locations\")");
    expect(src).toContain('google_api_reserve');
    expect(src).toContain('inFlight');
    expect(src).not.toMatch(/haversine|straight/i);
  });
});

describe('customer tracking map states without live Maps requests', () => {
  it('shows road distance and ETA from the route response', async () => {
    mocks.row = { lat: 0, lng: 0, received_at: new Date().toISOString() };
    render(<LiveRiderMap orderId="test-order" destLat={0} destLng={0.000126} />);
    await waitFor(() => expect(screen.getByLabelText('Current road distance to delivery: 1.4 km, about 5 min')).toBeInTheDocument());
    expect(screen.getByText('Live rider location · 1.4 km by road · ~5 min')).toBeInTheDocument();
    expect(screen.getByText('You · Delivery')).toBeInTheDocument();
    expect(screen.queryByText(/direct/i)).not.toBeInTheDocument();
    expect(mocks.invoke).toHaveBeenCalledWith('customer-rider-route', { body: { order_id: 'test-order' } });
  });
  it('never falls back to a direct distance when routing fails', async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: false, reason: 'provider_unreachable' }, error: null });
    mocks.row = { lat: 6, lng: 3, received_at: new Date().toISOString() };
    render(<LiveRiderMap orderId="test-order" destLat={6.01} destLng={3} />);
    await waitFor(() => expect(screen.getByText('Route temporarily unavailable · retrying')).toBeInTheDocument());
    expect(screen.getByText('Live rider location')).toBeInTheDocument();
    expect(screen.queryByText(/ m |km/)).not.toBeInTheDocument();
  });
  it('does not request a route for every GPS tick', async () => {
    mocks.row = { lat: 6, lng: 3, received_at: new Date().toISOString() };
    render(<LiveRiderMap orderId="test-order" destLat={6.01} destLng={3} />);
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    for (let i = 1; i <= 5; i++) await act(async () => { mocks.change?.({ eventType: 'UPDATE', new: { lat: 6 + i * 0.0001, lng: 3, received_at: new Date(Date.now() + i).toISOString() } }); });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it('keeps single-rider behavior without a destination and no route call', async () => {
    mocks.row = { lat: 6, lng: 3, received_at: new Date().toISOString() };
    render(<LiveRiderMap orderId="test-order" />);
    await waitFor(() => expect(screen.getByText('Live rider location')).toBeInTheDocument());
    expect(screen.queryByText('You · Delivery')).not.toBeInTheDocument();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it('recovers through scoped realtime and removes overlays on deletion', async () => {
    const { unmount } = render(<LiveRiderMap orderId="test-order" destLat={6} destLng={3} />);
    expect(screen.getByText('Connecting to rider location…')).toBeInTheDocument();
    await act(async () => { mocks.change?.({ eventType: 'UPDATE', new: { lat: 6, lng: 3, received_at: new Date().toISOString() } }); });
    await waitFor(() => expect(screen.getByText('Your rider')).toBeInTheDocument());
    await act(async () => { mocks.change?.({ eventType: 'DELETE' }); });
    expect(screen.queryByText('Your rider')).not.toBeInTheDocument();
    unmount(); expect(mocks.remove).toHaveBeenCalled();
  });
  it('does not route a stale location', async () => {
    mocks.row = { lat: 6, lng: 3, received_at: new Date(Date.now() - 600_000).toISOString() };
    render(<LiveRiderMap orderId="test-order" destLat={6} destLng={3} />);
    await waitFor(() => expect(screen.getByText('Rider location not updated recently')).toBeInTheDocument());
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

describe('feed recovery, heading and remaining-route helpers', () => {
  it('orients by valid heading when moving, by real movement otherwise, and keeps heading at rest', () => {
    const a = { lat: 6, lng: 3 };
    expect(chooseRiderHeading({ previous: null, prevPoint: null, next: a, gpsHeading: 90, speedMps: 5 })).toBe(90);
    expect(chooseRiderHeading({ previous: 45, prevPoint: a, next: { lat: 6.00002, lng: 3 }, gpsHeading: 270, speedMps: 0.2 })).toBe(45); // jitter at rest
    expect(Math.round(chooseRiderHeading({ previous: 45, prevPoint: a, next: { lat: 6.001, lng: 3 }, speedMps: 0 })!)).toBe(0);
    expect(Math.round(bearingDeg(a, { lat: 6, lng: 3.001 }))).toBe(90);
    expect(quantizeHeading(357)).toBe(0);
    expect(decodeURIComponent(trackingMarkerSvg('rider', 'g', 'w', 92))).toContain('rotate(90 32 32)');
  });
  it('trims travelled geometry only when the fix projects reliably onto the road path', () => {
    const route = { path: [{ lat: 6, lng: 3 }, { lat: 6.01, lng: 3 }], distanceM: 1100, durationS: 300 };
    const mid = remainingRoute(route, { lat: 6.005, lng: 3.00005 }, 8);
    expect(mid.estimated).toBe(true);
    expect(mid.path[0].lng).toBe(3); // starts on the road, no off-road connector
    expect(mid.distanceM).toBeGreaterThan(500); expect(mid.distanceM).toBeLessThan(600);
    const far = remainingRoute(route, { lat: 6.005, lng: 3.003 }, 8); // ~330 m off road
    expect(far).toMatchObject({ estimated: false, distanceM: 1100, path: route.path });
    expect(projectOntoPath({ lat: 6.005, lng: 3 }, route.path)!.offRouteM).toBeLessThan(1);
  });
  it('never lets an older row overwrite a newer one', () => {
    const old = { received_at: '2026-10-08T15:00:00Z', v: 1 }, nu = { received_at: '2026-10-08T15:00:10Z', v: 2 };
    expect(newerLocation(nu, old)).toBe(nu);
    expect(newerLocation(old, nu)).toBe(nu);
    expect(newerLocation(null, old)).toBe(old);
  });
  it('bounds resubscribes and polls only when disconnected or stale', () => {
    expect([1, 2, 3, 6, 8].map(resubscribeDelayMs)).toEqual([2000, 4000, 8000, 60000, 60000]);
    expect(resubscribeDelayMs(9)).toBeNull();
    const now = Date.parse('2026-10-08T15:01:00Z');
    expect(shouldPoll({ channelUp: false, lastReceivedAt: null, now, movingIntervalS: 12, polls: 0 })).toBe(true);
    expect(shouldPoll({ channelUp: true, lastReceivedAt: '2026-10-08T15:00:50Z', now, movingIntervalS: 12, polls: 0 })).toBe(false);
    expect(shouldPoll({ channelUp: true, lastReceivedAt: '2026-10-08T15:00:00Z', now, movingIntervalS: 12, polls: 0 })).toBe(true);
    expect(shouldPoll({ channelUp: false, lastReceivedAt: null, now, movingIntervalS: 12, polls: 80 })).toBe(false);
  });
  it('refreshes the route at ~45 m movement and the server returns the true route origin', () => {
    expect(ROUTE_MOVE_M).toBe(45);
    const path = [{ lat: 6, lng: 3 }, { lat: 6.01, lng: 3 }];
    expect(shouldRefreshRoute({ rider: { lat: 6.00045, lng: 3 }, routeOrigin: path[0], path, lastRequestAt: 0, now: 100_000, routeAt: 99_000 })).toBe(true);
    const src = readFileSync('supabase/functions/customer-rider-route/index.ts', 'utf8');
    expect(src).toContain('origin_received_at: loc.received_at, origin_lat: origin.lat');
    expect(src).toContain('{ ...hit.value, latest_received_at: loc.received_at, cached: true }');
  });
  it('initial fetch cannot overwrite a newer realtime fix', async () => {
    let resolve!: (v: unknown) => void;
    const slow = new Promise((r) => { resolve = r; });
    mocks.row = null;
    render(<LiveRiderMap orderId="race-order" />);
    const fresh = new Date().toISOString();
    await act(async () => { mocks.change?.({ eventType: 'UPDATE', new: { lat: 6, lng: 3, received_at: fresh } }); });
    void slow; resolve(null);
    await waitFor(() => expect(screen.getByText('Last updated just now')).toBeInTheDocument());
    const src = readFileSync('src/components/order/LiveRiderMap.tsx', 'utf8');
    expect(src).toContain('offerPoint(data as unknown as LivePoint)');
    expect(src).not.toMatch(/setPointState\(data/);
  });
});
