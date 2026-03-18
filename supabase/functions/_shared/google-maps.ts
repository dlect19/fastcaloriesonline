// Shared Google Maps Distance Matrix helper for edge functions

/**
 * Get road distance between two coordinates using Google Maps Distance Matrix API.
 * Falls back to Haversine if API is unavailable.
 */
export async function getGoogleMapsDistance(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number
): Promise<{ distanceKm: number; durationMinutes: number; source: 'google_maps' | 'haversine' }> {
  const apiKey = Deno.env.get('GOOGLE_MAPS_KEY');

  if (apiKey) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort('google_maps_timeout'), 4000);

    try {
      const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${originLat},${originLng}&destinations=${destLat},${destLng}&key=${apiKey}`;
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        console.warn('Google Maps API HTTP error:', response.status);
      } else {
        const data = await response.json();
        const element = data?.rows?.[0]?.elements?.[0];

        if (data.status === 'OK' && element?.status === 'OK') {
          return {
            distanceKm: Math.round((element.distance.value / 1000) * 10) / 10,
            durationMinutes: Math.round(element.duration.value / 60),
            source: 'google_maps',
          };
        }

        console.warn('Google Maps API returned non-OK status:', data.status, element?.status);
      }
    } catch (err) {
      console.warn('Google Maps API call failed, using Haversine fallback:', err);
    } finally {
      clearTimeout(timeout);
    }
  }

  // Haversine fallback
  const distanceKm = haversineDistance(originLat, originLng, destLat, destLng);
  const durationMinutes = Math.round((distanceKm / 25) * 60); // Assume 25 km/h average
  return { distanceKm: Math.round(distanceKm * 10) / 10, durationMinutes, source: 'haversine' };
}

export function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
