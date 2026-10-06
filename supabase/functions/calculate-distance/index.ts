// Road distance for signed-in app features (rider distance stats).
// Goes through the single cached/capped/logged Distance Matrix path.
import { getRoadDistance } from "../_shared/road-distance.ts";
import { guardGoogleProxy } from "../_shared/google-usage.ts";
import { haversineKm } from "../_shared/google-usage-core.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const isCoord = (n: unknown, max: number) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= max;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const guard = await guardGoogleProxy(req, { fn: 'calculate-distance', requireUser: true, perMinuteUser: 20 }, corsHeaders);
  if (guard instanceof Response) return guard;

  try {
    const { originLat, originLng, destLat, destLng } = await req.json();
    if (!isCoord(originLat, 90) || !isCoord(destLat, 90) || !isCoord(originLng, 180) || !isCoord(destLng, 180)) {
      return json({ error: 'Missing coordinates' }, 400);
    }

    const straightKm = haversineKm(originLat, originLng, destLat, destLng);
    if (straightKm < 0.5) {
      return json({ distanceInKm: 0, durationInMinutes: 0, distanceText: '0 km', durationText: '0 min', source: 'proximity' });
    }

    const r = await getRoadDistance({ lat: originLat, lng: originLng }, { lat: destLat, lng: destLng },
      { fn: 'calculate-distance', userHash: guard.userHash });
    if (!r.ok) return json({ error: r.reason === 'cap_reached' ? 'distance_temporarily_unavailable' : 'distance_unavailable' }, 503);

    return json({
      distanceInKm: r.km,
      durationInMinutes: r.minutes,
      distanceText: `${r.km} km`,
      durationText: `${r.minutes ?? 0} min`,
      source: r.source,
    });
  } catch (err) {
    console.error('calculate-distance error:', (err as Error).message);
    return json({ error: 'Internal error' }, 500);
  }
});
