import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Find expired proof photos
    const { data: expired, error: fetchErr } = await supabase
      .from('order_proof_photos')
      .select('id, storage_path')
      .lt('expires_at', new Date().toISOString());

    if (fetchErr) throw fetchErr;

    let deleted = 0;
    if (expired && expired.length > 0) {
      // Delete from storage
      const paths = expired.map(p => p.storage_path);
      await supabase.storage.from('order-photos').remove(paths);

      // Delete DB records
      const ids = expired.map(p => p.id);
      await supabase.from('order_proof_photos').delete().in('id', ids);
      deleted = ids.length;
    }

    return new Response(
      JSON.stringify({ success: true, deleted }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
