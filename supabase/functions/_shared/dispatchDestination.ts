// Authoritative destination coordinate resolution for dispatch.
// Pure (no Deno/network APIs) so it can be unit tested directly.

export type DestinationSource = 'order_inline' | 'saved_address';

export interface DestinationResolution {
  ok: boolean;
  latitude: number | null;
  longitude: number | null;
  source: DestinationSource | null;
  error?: 'MISSING_DESTINATION_COORDINATES';
}

export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  const la = typeof lat === 'string' ? Number(lat) : lat;
  const lo = typeof lng === 'string' ? Number(lng) : lng;
  if (typeof la !== 'number' || typeof lo !== 'number') return false;
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
  if (la === 0 && lo === 0) return false;
  if (la < -90 || la > 90) return false;
  if (lo < -180 || lo > 180) return false;
  return true;
}

/**
 * Precedence: the order's own inline delivery coordinates, then the linked
 * saved address. Never invents or zero-fills coordinates.
 */
export function resolveDestination(input: {
  orderLatitude?: number | string | null;
  orderLongitude?: number | string | null;
  addressLatitude?: number | string | null;
  addressLongitude?: number | string | null;
}): DestinationResolution {
  if (isValidCoordinate(input.orderLatitude, input.orderLongitude)) {
    return {
      ok: true,
      latitude: Number(input.orderLatitude),
      longitude: Number(input.orderLongitude),
      source: 'order_inline',
    };
  }
  if (isValidCoordinate(input.addressLatitude, input.addressLongitude)) {
    return {
      ok: true,
      latitude: Number(input.addressLatitude),
      longitude: Number(input.addressLongitude),
      source: 'saved_address',
    };
  }
  return {
    ok: false,
    latitude: null,
    longitude: null,
    source: null,
    error: 'MISSING_DESTINATION_COORDINATES',
  };
}
