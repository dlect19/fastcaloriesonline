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

    const { app_type, version, changelog } = await req.json();

    if (!app_type || !version) {
      return new Response(JSON.stringify({ error: 'app_type and version required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update platform_settings with the new version
    const versionKey = `${app_type}_apk_version`;
    const changelogKey = `${app_type}_apk_changelog`;

    await supabase.from('platform_settings').upsert(
      { key: versionKey, value: version, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
    await supabase.from('platform_settings').upsert(
      { key: changelogKey, value: changelog || 'Bug fixes and improvements', updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );

    // Get targeted user IDs based on app_type
    let targetUserIds: string[] = [];

    if (app_type === 'rider') {
      // Only notify users who are riders
      const { data: riders } = await supabase
        .from('rider_profiles')
        .select('user_id');
      targetUserIds = (riders || []).map(r => r.user_id).filter(Boolean);

    } else if (app_type === 'vendor') {
      // Only notify vendor owners + vendor staff
      const { data: vendors } = await supabase
        .from('vendors')
        .select('user_id');
      const vendorOwnerIds = (vendors || []).map(v => v.user_id).filter(Boolean);

      const { data: staff } = await supabase
        .from('vendor_staff')
        .select('user_id')
        .eq('is_active', true);
      const staffIds = (staff || []).map(s => s.user_id).filter(Boolean);

      targetUserIds = [...new Set([...vendorOwnerIds, ...staffIds])];

    } else {
      // Customer: notify users who are NOT riders and NOT vendors
      // Get all subscriber user_ids first, then exclude riders & vendors
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('user_id')
        .not('user_id', 'is', null);
      const allSubIds = [...new Set((subs || []).map(s => s.user_id).filter(Boolean))];

      const { data: riders } = await supabase
        .from('rider_profiles')
        .select('user_id');
      const riderIds = new Set((riders || []).map(r => r.user_id));

      const { data: vendors } = await supabase
        .from('vendors')
        .select('user_id');
      const vendorIds = new Set((vendors || []).map(v => v.user_id));

      const { data: staff } = await supabase
        .from('vendor_staff')
        .select('user_id')
        .eq('is_active', true);
      (staff || []).forEach(s => { if (s.user_id) vendorIds.add(s.user_id); });

      targetUserIds = allSubIds.filter(id => !riderIds.has(id) && !vendorIds.has(id));
    }

    if (targetUserIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: `No ${app_type} subscribers found` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Filter to only those with push subscriptions
    const { data: subs } = await supabase
      .from('push_subscriptions')
      .select('user_id')
      .in('user_id', targetUserIds);
    const subscribedUserIds = [...new Set((subs || []).map(s => s.user_id).filter(Boolean))];

    if (subscribedUserIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: `No ${app_type} users with push enabled` }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const appLabel = app_type === 'rider' ? 'Rider' : app_type === 'vendor' ? 'Vendor' : 'Customer';

    // Send push notifications in batches of 50
    let totalSent = 0;
    const batchSize = 50;

    for (let i = 0; i < subscribedUserIds.length; i += batchSize) {
      const batch = subscribedUserIds.slice(i, i + batchSize);

      const pushRes = await fetch(`${supabaseUrl}/functions/v1/send-push-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseKey}`,
        },
        body: JSON.stringify({
          user_ids: batch,
          title: `🚀 Fast Calories ${appLabel} App Updated!`,
          body: `Version ${version} is now available. ${changelog || 'Download for the latest improvements.'}`,
          url: '/install',
          data: { type: 'apk_update', app_type },
        }),
      });

      if (pushRes.ok) {
        const result = await pushRes.json();
        totalSent += result.sent || 0;
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      notified: totalSent,
      total_targeted: subscribedUserIds.length,
      app_type,
      version 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('APK update notification error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
