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