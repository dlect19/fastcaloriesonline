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

    // Get all user IDs with push subscriptions
    const { data: subs, error: subError } = await supabase
      .from('push_subscriptions')
      .select('user_id')
      .not('user_id', 'is', null);

    if (subError) throw subError;

    const uniqueUserIds = [...new Set((subs || []).map(s => s.user_id).filter(Boolean))];

    if (uniqueUserIds.length === 0) {
      return new Response(JSON.stringify({ sent: 0, message: 'No subscribers' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const appLabel = app_type === 'rider' ? 'Rider' : 'Customer';

    // Send push notifications in batches of 50
    let totalSent = 0;
    const batchSize = 50;

    for (let i = 0; i < uniqueUserIds.length; i += batchSize) {
      const batch = uniqueUserIds.slice(i, i + batchSize);

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
      total_subscribers: uniqueUserIds.length,
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
