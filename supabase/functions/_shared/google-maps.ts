// Shared distance helpers for edge functions.
// All Google Distance Matrix traffic goes through ./road-distance.ts
// (cache, daily cap, bounded retry, usage logging).
import { haversineKm } from "./google-usage-core.ts";
import { roadDistanceOrStraight } from "./road-distance.ts";

/**
 * Road distance with straight-line fallback. For non-pricing uses only
 * (dispatch, rider distance logs). Customer fees use delivery-pricing.ts.
 */
export async function getGoogleMapsDistance(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
  fn = "unknown",
): Promise<{ distanceKm: number; durationMinutes: number; source: "google_maps" | "cache" | "haversine" }> {
  return await roadDistanceOrStraight(
    { lat: originLat, lng: originLng },
    { lat: destLat, lng: destLng },
    { fn },
  );
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineKm(lat1, lon1, lat2, lon2);
}
