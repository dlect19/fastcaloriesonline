import { distanceM } from '@/lib/riderTracking';

export interface MapPoint { lat: number; lng: number }

export function mapPoint(lat?: number | null, lng?: number | null): MapPoint | null {
  return typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng } : null;
}

export function trackingDistanceLabel(metres: number): string {
  return metres < 1000 ? `${Math.round(metres)} m` : `${(metres / 1000).toFixed(1)} km`;
}

/** Never follows tiny GPS changes, or overrides a customer's own camera changes. */
export function shouldFitTrackingMap(previous: MapPoint | null, next: MapPoint, elapsedMs: number, userMoved: boolean, outside: boolean): boolean {
  if (userMoved) return false;
  return !previous || (outside && elapsedMs >= 20_000 && distanceM(previous, next) >= 150);
}

/** Local artwork only; colours come from the map's semantic CSS tokens. */
export function trackingMarkerSvg(kind: 'rider' | 'delivery', colour: string, ink: string): string {
  const artwork = kind === 'rider'
    ? '<circle cx="24" cy="35" r="6"/><circle cx="45" cy="35" r="6"/><path d="M24 35l8-12 8 12H24m16 0 3-15h6M31 23l-5-5m8 0 6 6m-6-6 3-4"/><circle cx="35" cy="10" r="3" fill="currentColor" stroke="none"/>'
    : '<path d="m19 29 15-13 15 13M23 26v20h22V26M30 46V34h8v12"/>';
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="68" height="68" viewBox="0 0 68 68"><circle cx="34" cy="32" r="29" fill="${colour}" stroke="${ink}" stroke-width="3"/><path d="m29 59 5 7 5-7" fill="${colour}"/><g color="${ink}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${artwork}</g></svg>`)}`;
}
/** Decodes a Google encoded polyline locally (no geometry library or network). */
export function decodePolyline(encoded: string): MapPoint[] {
  const out: MapPoint[] = []; let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i < encoded.length);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += d; else lng += d;
    }
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/** Approximate shortest distance (m) from a point to a path, using a local planar projection. */
export function distanceToPathM(p: MapPoint, path: MapPoint[]): number {
  if (!path.length) return Infinity;
  if (path.length === 1) return distanceM(p, path[0]);
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180), ky = 110_540;
  let best = Infinity;
  for (let i = 1; i < path.length; i++) {
    const ax = (path[i - 1].lng - p.lng) * kx, ay = (path[i - 1].lat - p.lat) * ky;
    const bx = (path[i].lng - p.lng) * kx, by = (path[i].lat - p.lat) * ky;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}

export const ROUTE_MIN_INTERVAL_MS = 20_000;
export const ROUTE_MOVE_M = 150;
export const ROUTE_DEVIATION_M = 60;
export const ROUTE_MAX_AGE_MS = 180_000;
export const ROUTE_MAX_FAILURES = 6;

/** Route refresh is throttled and only for meaningful movement, deviation, or age — never per GPS tick. */
export function shouldRefreshRoute(a: {
  rider: MapPoint; routeOrigin: MapPoint | null; path: MapPoint[] | null; lastRequestAt: number; now: number; routeAt: number;
}): boolean {
  if (a.now - a.lastRequestAt < ROUTE_MIN_INTERVAL_MS) return false;
  if (!a.path || !a.routeOrigin) return true;
  if (distanceM(a.rider, a.routeOrigin) >= ROUTE_MOVE_M) return true;
  if (distanceToPathM(a.rider, a.path) >= ROUTE_DEVIATION_M) return true;
  return a.now - a.routeAt >= ROUTE_MAX_AGE_MS && distanceM(a.rider, a.routeOrigin) >= 30;
}

/** Bounded exponential backoff: 5 s, 10 s, 20 s, 40 s, 80 s, then 120 s; null once retries are exhausted. */
export function routeBackoffMs(failures: number): number | null {
  if (failures >= ROUTE_MAX_FAILURES) return null;
  return Math.min(120_000, 5_000 * 2 ** Math.max(0, failures - 1));
}

export function etaLabel(seconds: number): string {
  const m = Math.max(1, Math.round(seconds / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
