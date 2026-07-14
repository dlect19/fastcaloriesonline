// Public stats endpoint for the marketing landing page.
// Returns real-time counts of vendors, riders and coverage.
// No auth required — safe aggregate numbers only.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Cache-Control': 'public, max-age=30', // 30s edge cache
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Run all counts in parallel
    const [
      activeVendorsRes,
      totalVendorsRes,
      verifiedRidersRes,
      totalRidersRes,
      onlineRidersRes,
      citiesRes,
      deliveredOrdersRes,
      usersRes,
    ] = await Promise.all([
      supabase.from('vendors').select('id', { count: 'exact', head: true })
        .eq('is_active', true).eq('is_verified', true).eq('is_test_store', false),
      supabase.from('vendors').select('id', { count: 'exact', head: true })
        .eq('is_test_store', false),
      supabase.from('rider_profiles').select('id', { count: 'exact', head: true })
        .eq('is_verified', true).eq('is_test_rider', false),
      supabase.from('rider_profiles').select('id', { count: 'exact', head: true })
        .eq('is_test_rider', false),
      supabase.from('rider_profiles').select('id', { count: 'exact', head: true })
        .eq('is_online', true).eq('is_test_rider', false),
      supabase.from('vendors').select('state')
        .eq('is_active', true).eq('is_test_store', false).not('state', 'is', null),
      supabase.from('orders').select('id', { count: 'exact', head: true })
        .eq('status', 'delivered'),
      supabase.from('profiles').select('id', { count: 'exact', head: true }),
    ]);

    const cities = new Set(
      (citiesRes.data ?? []).map((r: { state: string | null }) => (r.state || '').trim()).filter(Boolean)
    );

    const payload = {
      vendors: {
        active: activeVendorsRes.count ?? 0,
        total: totalVendorsRes.count ?? 0,
      },
      riders: {
        verified: verifiedRidersRes.count ?? 0,
        total: totalRidersRes.count ?? 0,
        online_now: onlineRidersRes.count ?? 0,
      },
      coverage: {
        cities: cities.size,
      },
      orders: {
        delivered: deliveredOrdersRes.count ?? 0,
      },
      generated_at: new Date().toISOString(),
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
