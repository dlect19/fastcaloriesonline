// Location utilities for distance calculation and geocoding

/**
 * Calculate distance between two coordinates using Haversine formula
 * @returns Distance in kilometers
 */
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
    Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

/**
 * Format distance for display
 */
export function formatDistance(distanceKm: number): string {
  if (distanceKm < 1) {
    return `${Math.round(distanceKm * 1000)} m`;
  }
  return `${distanceKm.toFixed(1)} km`;
}

/**
 * Calculate estimated delivery time based on distance
 * Assumes average speed of 25 km/h for delivery riders
 * Plus base preparation time
 */
export function calculateETA(
  distanceKm: number,
  preparationMinutes: number = 15
): number {
  const averageSpeedKmH = 25;
  const travelMinutes = (distanceKm / averageSpeedKmH) * 60;
  return Math.round(preparationMinutes + travelMinutes);
}

/**
 * Format ETA for display
 */
export function formatETA(minutes: number): string {
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
}

/**
 * Calculate delivery fee based on distance
 */
export function calculateDeliveryFee(
  distanceKm: number,
  baseFee: number,
  baseDistanceKm: number,
  perKmFee: number
): number {
  if (distanceKm <= baseDistanceKm) {
    return baseFee;
  }
  const extraDistance = distanceKm - baseDistanceKm;
  return Math.round(baseFee + (extraDistance * perKmFee));
}

/**
 * Check if a location is within a given radius
 */
export function isWithinRadius(
  centerLat: number,
  centerLon: number,
  pointLat: number,
  pointLon: number,
  radiusKm: number
): boolean {
  const distance = calculateDistance(centerLat, centerLon, pointLat, pointLon);
  return distance <= radiusKm;
}

/**
 * Sort locations by distance from a point
 */
export function sortByDistance<T extends { latitude: number | null; longitude: number | null }>(
  items: T[],
  fromLat: number,
  fromLon: number
): (T & { distance: number })[] {
  return items
    .filter(item => item.latitude !== null && item.longitude !== null)
    .map(item => ({
      ...item,
      distance: calculateDistance(fromLat, fromLon, item.latitude!, item.longitude!)
    }))
    .sort((a, b) => a.distance - b.distance);
}
