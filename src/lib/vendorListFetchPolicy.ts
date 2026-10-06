// Client-side guard against vendor-list refetch storms.
// - GPS jitter under ~300 m keeps the previous anchor (no refetch).
// - Remounts/navigation within the TTL reuse the last result.

export const MOVE_THRESHOLD_M = 300;
export const VENDOR_LIST_CACHE_TTL_MS = 2 * 60 * 1000;

export type Coords = { lat: number; lng: number };

export function distanceMeters(a: Coords, b: Coords): number {
  const R = 6371000;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lng - a.lng) * Math.PI / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Returns the anchor to query with: the previous one unless the user moved meaningfully. */
export function nextAnchor(prev: Coords | null, current: Coords | null, thresholdM = MOVE_THRESHOLD_M): Coords | null {
  if (!current) return prev;
  if (!prev) return current;
  return distanceMeters(prev, current) >= thresholdM ? current : prev;
}

type Entry<T> = { at: number; value: T };
const cache = new Map<string, Entry<unknown>>();

export function vendorListCacheKey(anchor: Coords, category: string | null, state: string | null): string {
  return `${anchor.lat.toFixed(4)},${anchor.lng.toFixed(4)}|${category ?? 'all'}|${(state ?? '').toLowerCase()}`;
}

export function readVendorListCache<T>(key: string, now = Date.now()): T | null {
  const e = cache.get(key);
  if (!e || now - e.at > VENDOR_LIST_CACHE_TTL_MS) return null;
  return e.value as T;
}

export function writeVendorListCache<T>(key: string, value: T, now = Date.now()): void {
  cache.set(key, { at: now, value });
  if (cache.size > 30) cache.delete(cache.keys().next().value as string);
}

export function clearVendorListCache(): void {
  cache.clear();
}
