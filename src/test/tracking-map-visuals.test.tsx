import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { mapPoint, shouldFitTrackingMap, trackingDistanceLabel, trackingMarkerSvg } from '@/lib/trackingMapVisuals';

const mocks = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, change: null as ((p: any) => void) | null, remove: vi.fn(), eq: vi.fn() }));
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
} }));
import { LiveRiderMap } from '@/components/order/LiveRiderMap';

beforeEach(() => { mocks.row = null; mocks.change = null; mocks.remove.mockClear(); mocks.eq.mockClear(); });

describe('local tracking map artwork and geometry', () => {
  it('renders distinct motorcycle and house SVG artwork, never a red pin', () => {
    const rider = decodeURIComponent(trackingMarkerSvg('rider', 'green', 'white').split(',')[1]);
    const home = decodeURIComponent(trackingMarkerSvg('delivery', 'orange', 'white').split(',')[1]);
    expect(rider).toContain('cx="24" cy="35"');
    expect(rider).toContain('cx="45" cy="35"');
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
  it('uses a two-point polyline updated with interpolation, fits both points, and cleans overlays', () => {
    const src = readFileSync('src/components/order/LiveRiderMap.tsx', 'utf8');
    expect(src).toContain('new google.maps.Polyline');
    expect(src).toContain('setPath([p, destination])');
    expect(src).toContain('b.extend(rider); b.extend(destination)');
    expect(src).toContain('setMap(null)');
    expect(src).toContain('[ready, point, destLat, destLng]');
    expect(src).not.toMatch(/DirectionsService|DistanceMatrix|computeRoutes|Geocoder|fetch\(|functions\.invoke/);
    expect(src).not.toMatch(/styles:|styledMapType/);
  });
});

describe('customer tracking map accessible states without live Maps requests', () => {
  it('shows both labels and a direct distance badge even while the map loads', async () => {
    mocks.row = { lat: 0, lng: 0, received_at: new Date().toISOString() };
    render(<LiveRiderMap orderId="test-order" destLat={0} destLng={0.000126} />);
    await waitFor(() => expect(screen.getByLabelText('Current direct distance to delivery: 14 m')).toBeInTheDocument());
    expect(screen.getByText('Your rider')).toBeInTheDocument();
    expect(screen.getByText('You · Delivery')).toBeInTheDocument();
    expect(screen.getByText('Live rider location · 14 m away (direct)')).toBeInTheDocument();
    expect(screen.getByText('Loading map…')).toBeInTheDocument();
    expect(mocks.eq).toHaveBeenCalledWith('order_id', 'test-order');
  });
  it('keeps single-rider behavior without a destination and no fake distance', async () => {
    mocks.row = { lat: 6, lng: 3, received_at: new Date().toISOString() };
    render(<LiveRiderMap orderId="test-order" />);
    await waitFor(() => expect(screen.getByText('Live rider location')).toBeInTheDocument());
    expect(screen.queryByText('You · Delivery')).not.toBeInTheDocument();
    expect(screen.queryByText('Direct distance')).not.toBeInTheDocument();
  });
  it('recovers from no rider through scoped realtime and removes stale overlays on deletion', async () => {
    const { unmount } = render(<LiveRiderMap orderId="test-order" destLat={6} destLng={3} />);
    expect(screen.getByText('Connecting to rider location…')).toBeInTheDocument();
    await act(async () => { mocks.change?.({ eventType: 'UPDATE', new: { lat: 6, lng: 3, received_at: new Date().toISOString() } }); });
    expect(screen.getByText('Live rider location · 0 m away (direct)')).toBeInTheDocument();
    await act(async () => { mocks.change?.({ eventType: 'DELETE' }); });
    expect(screen.queryByText('Your rider')).not.toBeInTheDocument();
    unmount(); expect(mocks.remove).toHaveBeenCalled();
  });
  it('marks distance as last known when stale', async () => {
    mocks.row = { lat: 6, lng: 3, received_at: new Date(Date.now() - 600_000).toISOString() };
    render(<LiveRiderMap orderId="test-order" destLat={6} destLng={3} />);
    await waitFor(() => expect(screen.getByLabelText('Last known direct distance to delivery: 0 m')).toBeInTheDocument());
    expect(screen.getByText('Rider location not updated recently')).toBeInTheDocument();
  });
});