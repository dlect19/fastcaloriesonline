import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { title, body, url, target } = await req.json();

    if (!title || !body) {
      return new Response(JSON.stringify({ error: 'title and body required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get all push subscriber user_ids
    const { data: subs, error: subError } = await supabase
      .from('push_subscriptions')
      .select('user_id')
      .not('user_id', 'is', null);

    if (subError) throw subError;

    const allSubUserIds = [...new Set((subs || []).map(s => s.user_id).filter(Boolean))];
    console.log(`Total push subscribers: ${allSubUserIds.length}, target: "${target}"`);

    if (allSubUserIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, message: 'No subscribers found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let targetUserIds: string[] = allSubUserIds;

    if (target && target !== 'all') {
      // Fetch role data using service role (bypasses RLS)
      const { data: riders } = await supabase.from('rider_profiles').select('user_id');
      const riderIds = new Set((riders || []).map(r => r.user_id).filter(Boolean));
      console.log(`Found ${riderIds.size} riders`);

      const { data: vendors } = await supabase.from('vendors').select('user_id');
      const vendorOwnerIds = (vendors || []).map(v => v.user_id).filter(Boolean);

      const { data: vendorStaff } = await supabase.from('vendor_staff').select('user_id').eq('is_active', true);
      const vendorStaffIds = (vendorStaff || []).map(s => s.user_id).filter(Boolean);

      const allVendorIds = new Set([...vendorOwnerIds, ...vendorStaffIds]);
      console.log(`Found ${allVendorIds.size} vendors (${vendorOwnerIds.length} owners + ${vendorStaffIds.length} staff)`);

      if (target === 'customers') {
        targetUserIds = allSubUserIds.filter(id => !riderIds.has(id) && !allVendorIds.has(id));
      } else if (target === 'riders') {
        targetUserIds = allSubUserIds.filter(id => riderIds.has(id));
      } else if (target === 'vendors') {
        targetUserIds = allSubUserIds.filter(id => allVendorIds.has(id));
      }

      console.log(`Filtered to ${targetUserIds.length} ${target} targets`);
    }

    if (targetUserIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, failed: 0, message: `No ${target} subscribers found` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Send in batches
    let totalSent = 0;
    let totalFailed = 0;
    const batchSize = 50;

    for (let i = 0; i < targetUserIds.length; i += batchSize) {
      const batch = targetUserIds.slice(i, i + batchSize);

      const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          user_ids: batch,
          title,
          body,
          url: url || '/',
        }),
      });

      if (pushRes.ok) {
        const result = await pushRes.json();
        totalSent += result.sent || 0;
        totalFailed += result.failed || 0;
      } else {
        totalFailed += batch.length;
      }
    }

    return new Response(JSON.stringify({ sent: totalSent, failed: totalFailed, total_targeted: targetUserIds.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Broadcast notification error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
