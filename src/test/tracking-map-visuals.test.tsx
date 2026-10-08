import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { decodePolyline, distanceToPathM, etaLabel, mapPoint, routeBackoffMs, shouldFitTrackingMap, shouldRefreshRoute, trackingDistanceLabel, trackingMarkerSvg } from '@/lib/trackingMapVisuals';
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
    expect(rider).toContain('cx="20" cy="41" r="7"');
    expect(rider).toContain('cx="48" cy="41" r="7"');
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
    expect(src).toContain('setPath(route.path)');
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
