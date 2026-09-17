// Cron-safe dispatch expiry + retry sweep.
//
// Expires pending offers and stale dispatch requests using SERVER time (via the
// dispatch_sweep_expiry RPC, which holds a transaction-level advisory lock so
// only one round can run at a time), then re-dispatches the orders that are
// still genuinely eligible with a widened radius and backoff. History is marked
// expired/superseded, never deleted.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RetryCandidate {
  dispatch_request_id: string;
  order_id: string;
  order_number: string | null;
  retry_count: number;
  max_retries: number;
  search_radius_km: number;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let limit = 25;
    let dryRun = false;
    try {
      const body = await req.json();
      if (typeof body?.limit === 'number') limit = body.limit;
      dryRun = body?.dryRun === true;
    } catch {
      // no body — use defaults
    }

    const { data: sweep, error: sweepError } = await supabase.rpc('dispatch_sweep_expiry', {
      p_limit: limit,
    });

    if (sweepError) {
      console.error('dispatch_sweep_expiry failed:', sweepError);
      return new Response(
        JSON.stringify({ error: 'Sweep failed', detail: sweepError.message }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    const result = (sweep || {}) as Record<string, unknown>;
    const candidates = (result.retry_candidates || []) as RetryCandidate[];
    const radiusStepKm = 3;
    const retries: Array<Record<string, unknown>> = [];

    if (!dryRun) {
      for (const candidate of candidates) {
        const nextRound = (candidate.retry_count || 0) + 1;
        const widenedRadius = (candidate.search_radius_km || 5) + radiusStepKm * nextRound;
        try {
          const res = await fetch(`${supabaseUrl}/functions/v1/dispatch-order`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              orderId: candidate.order_id,
              radiusKm: widenedRadius,
              retryRound: nextRound,
            }),
          });
          const payload = await res.json().catch(() => ({}));
          retries.push({
            order_number: candidate.order_number,
            order_id: candidate.order_id,
            round: nextRound,
            radius_km: widenedRadius,
            ok: res.ok,
            eligible_rider_count: payload?.eligibleRiderCount ?? null,
            error: res.ok ? null : payload?.error ?? `HTTP ${res.status}`,
          });
        } catch (err) {
          retries.push({
            order_number: candidate.order_number,
            order_id: candidate.order_id,
            round: nextRound,
            ok: false,
            error: String(err),
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dryRun,
        expiredOffers: result.expired_offers ?? 0,
        expiredRequests: result.expired_requests ?? 0,
        skipped: result.skipped ?? null,
        retryCandidates: candidates.length,
        retries,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('Error in dispatch-retry-sweep:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
