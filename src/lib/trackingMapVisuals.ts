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

/** Quantised so tiny heading noise never regenerates the marker artwork. */
export function quantizeHeading(deg: number): number { return ((Math.round(deg / 10) * 10) % 360 + 360) % 360; }

/**
 * Original FastCalories artwork (local SVG, transparent background with a white halo).
 * Rider: top-down rider on a motorcycle pointing up, rotated to `heading` (degrees from north).
 * Delivery: branded home pin. Colours come from the map's semantic CSS tokens.
 */
export function trackingMarkerSvg(kind: 'rider' | 'delivery', colour: string, ink: string, heading = 0): string {
  if (kind === 'rider') {
    const h = quantizeHeading(heading);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><g transform="rotate(${h} 32 32)">` +
      `<g fill="none" stroke="${ink}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round" data-part="halo"><rect x="27" y="6" width="10" height="13" rx="4"/><rect x="27" y="45" width="10" height="13" rx="4"/><path d="M24 18h16l3 26H21z"/><path d="M18 22h28"/></g>` +
      `<rect x="27.5" y="6.5" width="9" height="12" rx="4" fill="#1f2937" data-part="front-tyre"/><rect x="27.5" y="45.5" width="9" height="12" rx="4" fill="#1f2937" data-part="rear-tyre"/>` +
      `<path d="M18 22h28" stroke="#1f2937" stroke-width="3" stroke-linecap="round" data-part="handlebar"/>` +
      `<path d="M24 18h16l3 26H21z" fill="${colour}" data-part="bike-body"/>` +
      `<ellipse cx="32" cy="35" rx="8" ry="9" fill="${colour}" stroke="${ink}" stroke-width="2" data-part="rider-body"/>` +
      `<circle cx="32" cy="27" r="6.5" fill="${ink}" stroke="#1f2937" stroke-width="2" data-part="helmet"/><path d="M27.5 25.5a5 4 0 0 1 9 0" fill="none" stroke="#1f2937" stroke-width="2" stroke-linecap="round" data-part="visor"/>` +
      `<path d="M32 2l5 6h-10z" fill="${colour}" stroke="${ink}" stroke-width="1.5" data-part="direction"/></g></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  }
  const art = '<path d="m19 29 15-13 15 13M23 26v20h22V26M30 46V34h8v12"/>';
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="68" height="68" viewBox="0 0 68 68"><circle cx="34" cy="32" r="29" fill="${colour}" stroke="${ink}" stroke-width="3"/><path d="m29 59 5 7 5-7" fill="${colour}"/><g color="${ink}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">${art}</g></svg>`)}`;
}

/** Initial bearing a→b in degrees from north. */
export function bearingDeg(a: MapPoint, b: MapPoint): number {
  const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

/**
 * Marker heading: the device heading when moving with a valid value, else the bearing of a real
 * movement (beyond GPS jitter), else the previous heading (kept at rest, no jitter spin).
 */
export function chooseRiderHeading(a: {
  previous: number | null; prevPoint: MapPoint | null; next: MapPoint; gpsHeading?: number | null; speedMps?: number | null; accuracyM?: number | null;
}): number | null {
  const moving = (a.speedMps ?? 0) >= 1;
  if (moving && typeof a.gpsHeading === 'number' && Number.isFinite(a.gpsHeading) && a.gpsHeading >= 0 && a.gpsHeading <= 360) return a.gpsHeading % 360;
  if (a.prevPoint && distanceM(a.prevPoint, a.next) >= Math.max(12, a.accuracyM ?? 0)) return bearingDeg(a.prevPoint, a.next);
  return a.previous;
}

export interface PathProjection { index: number; point: MapPoint; offRouteM: number }
/** Nearest point on the route polyline (segment index + projected point + perpendicular distance). */
export function projectOntoPath(p: MapPoint, path: MapPoint[]): PathProjection | null {
  if (path.length < 2) return null;
  const kx = 111_320 * Math.cos((p.lat * Math.PI) / 180), ky = 110_540;
  let best: PathProjection | null = null;
  for (let i = 1; i < path.length; i++) {
    const ax = (path[i - 1].lng - p.lng) * kx, ay = (path[i - 1].lat - p.lat) * ky;
    const bx = (path[i].lng - p.lng) * kx, by = (path[i].lat - p.lat) * ky;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (!best || d < best.offRouteM) best = { index: i, offRouteM: d, point: { lat: path[i - 1].lat + (path[i].lat - path[i - 1].lat) * t, lng: path[i - 1].lng + (path[i].lng - path[i - 1].lng) * t } };
  }
  return best;
}

export function pathLengthM(path: MapPoint[]): number {
  let m = 0; for (let i = 1; i < path.length; i++) m += distanceM(path[i - 1], path[i]); return m;
}

/** Projection is trusted only when the fix is close to the road path (never snaps far-off GPS). */
export const TRIM_MAX_OFF_ROUTE_M = 30;

export interface RemainingRoute { path: MapPoint[]; distanceM: number; durationS: number; estimated: boolean }
/**
 * Trims the travelled part of the provider route locally. Remaining distance/ETA are scaled
 * from the provider values and flagged `estimated` once trimmed; an unreliable projection
 * returns the provider route untouched. Never adds a connector from the rider to the road.
 */
export function remainingRoute(route: { path: MapPoint[]; distanceM: number; durationS: number }, rider: MapPoint | null, accuracyM?: number | null): RemainingRoute {
  const full = { path: route.path, distanceM: route.distanceM, durationS: route.durationS, estimated: false };
  if (!rider) return full;
  const proj = projectOntoPath(rider, route.path);
  if (!proj || proj.offRouteM > Math.max(TRIM_MAX_OFF_ROUTE_M, Math.min(50, accuracyM ?? 0))) return full;
  const rest = [proj.point, ...route.path.slice(proj.index)];
  const total = pathLengthM(route.path), left = pathLengthM(rest);
  if (total <= 0 || total - left < 10) return full; // nothing meaningfully travelled yet
  const ratio = Math.max(0, Math.min(1, left / total));
  return { path: rest, distanceM: route.distanceM * ratio, durationS: route.durationS * ratio, estimated: true };
}

/** Accept a location row only when it is newer than what is shown (realtime vs fetch vs poll races). */
export function newerLocation<T extends { received_at: string }>(prev: T | null, next: T | null): T | null {
  if (!next) return prev;
  if (!prev) return next;
  return new Date(next.received_at).getTime() > new Date(prev.received_at).getTime() ? next : prev;
}

/** Realtime recovery: bounded resubscribe backoff (2 s … 60 s, 8 tries) and fallback polling cadence. */
export const RT_MAX_RESUBSCRIBES = 8;
export function resubscribeDelayMs(attempt: number): number | null {
  if (attempt > RT_MAX_RESUBSCRIBES) return null;
  return Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1));
}
export const POLL_INTERVAL_MS = 15_000;
export const POLL_MAX_COUNT = 80; // ~20 minutes, then the user can tap to resume
/** Poll only when realtime is down, or when the shown fix is older than ~2 moving intervals. */
export function shouldPoll(a: { channelUp: boolean; lastReceivedAt: string | null; now: number; movingIntervalS: number; polls: number }): boolean {
  if (a.polls >= POLL_MAX_COUNT) return false;
  if (!a.channelUp) return true;
  if (!a.lastReceivedAt) return true;
  return a.now - new Date(a.lastReceivedAt).getTime() > Math.max(30_000, a.movingIntervalS * 2500);
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
export const ROUTE_MOVE_M = 45;
export const ROUTE_DEVIATION_M = 50;
export const ROUTE_MAX_AGE_MS = 180_000;
export const ROUTE_MAX_FAILURES = 6;

/** Route refresh is throttled and only for meaningful movement, deviation, or age — never per GPS tick. */
export function shouldRefreshRoute(a: {
  rider: MapPoint; routeOrigin: MapPoint | null; path: MapPoint[] | null; lastRequestAt: number; now: number; routeAt: number;
}): boolean {
  if (a.now - a.lastRequestAt < ROUTE_MIN_INTERVAL_MS) return false;
  if (!a.path || !a.routeOrigin) return true;
  // Only when the rider has actually moved from where this route started (or left it).
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
