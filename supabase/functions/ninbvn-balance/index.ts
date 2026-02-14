import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const apiKey = Deno.env.get('NINBVN_API_KEY');
    if (!apiKey) {
      throw new Error('NINBVN_API_KEY is not configured');
    }

    const response = await fetch('https://checkmyninbvn.com.ng/api/balance', {
      method: 'GET',
      headers: { 'x-api-key': apiKey },
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`NinBVN API error [${response.status}]: ${text}`);
    }

    const data = await response.json();

    return new Response(JSON.stringify({ success: true, data }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('NinBVN balance error:', message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
