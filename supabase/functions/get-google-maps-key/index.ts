// Returns ONLY the referrer-restricted browser Maps key (GOOGLE_MAPS_BROWSER_KEY).
// Never returns the server key. Allowed app origins only, rate limited.
import { selectBrowserMapsKey } from "../_shared/google-usage-core.ts";
import { guardGoogleProxy, logGoogleUsage } from "../_shared/google-usage.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Public coverage map needs the browser key, so guests from allowed app
  // origins are permitted; requests without an Origin must be signed in.
  const guard = await guardGoogleProxy(req, { fn: 'get-google-maps-key', perMinuteUser: 30, perMinuteGuest: 10 }, corsHeaders);
  if (guard instanceof Response) return guard;

  const key = selectBrowserMapsKey((k) => Deno.env.get(k));
  logGoogleUsage({
    provider: 'google_maps', endpoint: 'browser_key_issued', api: 'maps_js', function_name: 'get-google-maps-key',
    environment: guard.env, outcome: key ? 'success' : 'not_configured', billable_elements: 0,
    cost_estimate_usd: 0, cache_status: 'none', user_hash: guard.userHash, ip_hash: guard.ipHash,
  });
  if (!key) {
    return json({
      error: 'browser_key_not_configured',
      message: 'Maps are temporarily unavailable: the browser map key has not been configured by an administrator.',
    }, 503);
  }
  return json({ key });
});
