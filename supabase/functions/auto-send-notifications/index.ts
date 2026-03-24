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

    const now = new Date();
    const currentHour = now.getUTCHours() + 1; // WAT = UTC+1
    const currentDay = now.getUTCDay();

    // Get active schedules that are due
    const { data: schedules, error: schedErr } = await supabase
      .from('auto_notification_schedules')
      .select('*')
      .eq('is_active', true)
      .lte('starts_at', now.toISOString())
      .or(`ends_at.is.null,ends_at.gte.${now.toISOString()}`);

    if (schedErr) {
      console.error('Error fetching schedules:', schedErr);
      return new Response(JSON.stringify({ error: schedErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let totalSent = 0;
    let schedulesProcessed = 0;

    for (const schedule of (schedules || [])) {
      // Check active hours (WAT)
      const watHour = currentHour >= 24 ? currentHour - 24 : currentHour;
      if (watHour < schedule.active_hours_start || watHour >= schedule.active_hours_end) continue;

      // Check active days
      if (schedule.active_days && !schedule.active_days.includes(currentDay)) continue;

      // Check interval - has enough time passed since last send?
      // If schedule start time was moved forward after the previous send,
      // treat it as a fresh schedule so the new start time can trigger immediately.
      if (schedule.last_sent_at) {
        const lastSent = new Date(schedule.last_sent_at);
        const startsAt = schedule.starts_at ? new Date(schedule.starts_at) : null;
        const startMovedAfterLastSend = startsAt ? startsAt.getTime() > lastSent.getTime() : false;

        if (!startMovedAfterLastSend) {
          const minutesSince = (now.getTime() - lastSent.getTime()) / 60000;
          if (minutesSince < schedule.interval_minutes) continue;
        }
      }

      // Pick a random template matching this schedule's criteria
      let query = supabase
        .from('auto_notification_templates')
        .select('*')
        .eq('is_active', true)
        .in('target_audience', [schedule.target_audience, 'all']);

      if (schedule.category) {
        query = query.eq('category', schedule.category);
      }

      const { data: templates } = await query;

      if (!templates || templates.length === 0) {
        console.log(`No templates for schedule "${schedule.name}"`);
        continue;
      }

      // Pick random template
      const template = templates[Math.floor(Math.random() * templates.length)];

      // Send via broadcast-notification
      try {
        const response = await fetch(
          `${supabaseUrl}/functions/v1/broadcast-notification`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              title: template.title,
              body: template.body,
              url: template.url || '/',
              target: schedule.target_audience,
            }),
          }
        );

        const result = await response.json();
        const sentCount = result.sent || 0;
        totalSent += sentCount;
        schedulesProcessed++;

        // Only update last_sent_at if notifications were actually delivered
        if (sentCount > 0) {
          await supabase
            .from('auto_notification_schedules')
            .update({
              last_sent_at: now.toISOString(),
              total_sent: (schedule.total_sent || 0) + sentCount,
              updated_at: now.toISOString(),
            })
            .eq('id', schedule.id);
        }

        console.log(`Schedule "${schedule.name}" → sent template "${template.title}" to ${result.sent} users`);
      } catch (e) {
        console.error(`Failed schedule "${schedule.name}":`, e);
      }
    }

    return new Response(
      JSON.stringify({ schedules_processed: schedulesProcessed, total_sent: totalSent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('auto-send-notifications error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
