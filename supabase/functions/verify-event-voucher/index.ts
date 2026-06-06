import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No auth' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: { user } } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { lookup, vendor_id } = await req.json();
    if (!lookup || !vendor_id) {
      return new Response(JSON.stringify({ error: 'lookup and vendor_id required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify caller owns or staffs this vendor
    const { data: owns } = await admin
      .from('vendors').select('id').eq('id', vendor_id).eq('user_id', user.id).maybeSingle();
    let allowed = !!owns;
    if (!allowed) {
      const { data: staff } = await admin
        .from('vendor_staff').select('id').eq('vendor_id', vendor_id).eq('user_id', user.id).eq('is_active', true).maybeSingle();
      allowed = !!staff;
    }
    if (!allowed) {
      // also allow platform admins
      const { data: roleRow } = await admin
        .from('user_roles').select('role').eq('user_id', user.id).eq('role', 'admin').maybeSingle();
      allowed = !!roleRow;
    }
    if (!allowed) {
      return new Response(JSON.stringify({ ok: false, status: 'UNAUTHORIZED' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data, error } = await admin.rpc('redeem_voucher_at_venue', {
      p_lookup: String(lookup).trim(),
      p_vendor_id: vendor_id,
      p_staff_id: user.id,
    });

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
