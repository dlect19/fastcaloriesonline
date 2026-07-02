// Map/distance provider abstraction — Phase 6.
// The active provider is picked from `platform_settings.map_provider`
// (defaults to google). New providers just implement DistanceProvider.

export interface DistanceResult {
  distance_km: number;
  duration_min: number;
}

export interface DistanceProvider {
  name: string;
  distance(
    origin: { lat: number; lng: number },
    dest: { lat: number; lng: number },
  ): Promise<DistanceResult>;
}

// --- Google Maps (default) ----------------------------------------------
const google: DistanceProvider = {
  name: 'google_maps',
  async distance(origin, dest) {
    const key = Deno.env.get('GOOGLE_MAPS_API_KEY');
    if (!key) throw new Error('GOOGLE_MAPS_API_KEY missing');
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origin.lat},${origin.lng}&destinations=${dest.lat},${dest.lng}&key=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`google_maps http ${res.status}`);
    const d = await res.json();
    const el = d?.rows?.[0]?.elements?.[0];
    if (!el || el.status !== 'OK') throw new Error(`google_maps status ${el?.status}`);
    return {
      distance_km: (el.distance?.value ?? 0) / 1000,
      duration_min: (el.duration?.value ?? 0) / 60,
    };
  },
};

// --- OpenRouteService (requires ORS_API_KEY) ----------------------------
const openRoute: DistanceProvider = {
  name: 'openrouteservice',
  async distance(origin, dest) {
    const key = Deno.env.get('ORS_API_KEY');
    if (!key) throw new Error('ORS_API_KEY missing');
    const url = 'https://api.openrouteservice.org/v2/matrix/driving-car';
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations: [[origin.lng, origin.lat], [dest.lng, dest.lat]],
        metrics: ['distance', 'duration'],
      }),
    });
    if (!res.ok) throw new Error(`ors http ${res.status}`);
    const d = await res.json();
    return {
      distance_km: (d?.distances?.[0]?.[1] ?? 0) / 1000,
      duration_min: (d?.durations?.[0]?.[1] ?? 0) / 60,
    };
  },
};

// --- Mapbox (requires MAPBOX_TOKEN) -------------------------------------
const mapbox: DistanceProvider = {
  name: 'mapbox',
  async distance(origin, dest) {
    const key = Deno.env.get('MAPBOX_TOKEN');
    if (!key) throw new Error('MAPBOX_TOKEN missing');
    const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?access_token=${key}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`mapbox http ${res.status}`);
    const d = await res.json();
    const route = d?.routes?.[0];
    if (!route) throw new Error('mapbox no route');
    return {
      distance_km: (route.distance ?? 0) / 1000,
      duration_min: (route.duration ?? 0) / 60,
    };
  },
};

export function getDistanceProvider(name: string | undefined | null): DistanceProvider {
  switch ((name || '').toLowerCase()) {
    case 'openrouteservice':
    case 'ors': return openRoute;
    case 'mapbox': return mapbox;
    case 'google_maps':
    case 'google':
    default: return google;
  }
}
