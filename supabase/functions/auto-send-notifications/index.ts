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
    const utcHour = now.getUTCHours();
    const watHour = (utcHour + 1) % 24;
    const currentDay = now.getUTCDay();

    console.log(`[AUTO-SEND] Running at ${now.toISOString()} | UTC hour: ${utcHour} | WAT hour: ${watHour} | Day: ${currentDay}`);

    // Get active schedules that are due
    const { data: schedules, error: schedErr } = await supabase
      .from('auto_notification_schedules')
      .select('*')
      .eq('is_active', true)
      .lte('starts_at', now.toISOString())
      .or(`ends_at.is.null,ends_at.gte.${now.toISOString()}`);

    if (schedErr) {
      console.error('[AUTO-SEND] Error fetching schedules:', schedErr);
      return new Response(JSON.stringify({ error: schedErr.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[AUTO-SEND] Found ${(schedules || []).length} active schedule(s)`);

    let totalSent = 0;
    let schedulesProcessed = 0;

    for (const schedule of (schedules || [])) {
      console.log(`[AUTO-SEND] Checking "${schedule.name}" — interval: ${schedule.interval_minutes}min, hours: ${schedule.active_hours_start}-${schedule.active_hours_end}, last_sent: ${schedule.last_sent_at}`);

      // Check active hours (WAT)
      if (watHour < schedule.active_hours_start || watHour >= schedule.active_hours_end) {
        console.log(`[AUTO-SEND] SKIP "${schedule.name}": WAT hour ${watHour} outside window ${schedule.active_hours_start}-${schedule.active_hours_end}`);
        continue;
      }

      // Check active days
      if (schedule.active_days && !schedule.active_days.includes(currentDay)) {
        console.log(`[AUTO-SEND] SKIP "${schedule.name}": day ${currentDay} not in [${schedule.active_days}]`);
        continue;
      }

      // Interval check: use starts_at as anchor
      const startsAtMs = schedule.starts_at ? new Date(schedule.starts_at).getTime() : now.getTime();
      const nowMs = now.getTime();

      if (nowMs < startsAtMs) {
        console.log(`[AUTO-SEND] SKIP "${schedule.name}": not started yet`);
        continue;
      }

      const intervalMs = Math.max(1, Number(schedule.interval_minutes || 0)) * 60 * 1000;
      const slotIndex = Math.floor((nowMs - startsAtMs) / intervalMs);
      const currentSlotStartMs = startsAtMs + slotIndex * intervalMs;

      console.log(`[AUTO-SEND] "${schedule.name}" — slot ${slotIndex}, slot start: ${new Date(currentSlotStartMs).toISOString()}`);

      // Already sent for this interval slot?
      if (schedule.last_sent_at) {
        const lastSentMs = new Date(schedule.last_sent_at).getTime();
        if (lastSentMs >= currentSlotStartMs) {
          const nextSlotMs = currentSlotStartMs + intervalMs;
          console.log(`[AUTO-SEND] SKIP "${schedule.name}": already sent at ${schedule.last_sent_at}, next slot at ${new Date(nextSlotMs).toISOString()}`);
          continue;
        }
      }

      console.log(`[AUTO-SEND] "${schedule.name}" is DUE — finding templates...`);

      // Pick a random template matching this schedule's criteria
      let query = supabase
        .from('auto_notification_templates')
        .select('*')
        .eq('is_active', true)
        .in('target_audience', [schedule.target_audience, 'all']);

      if (schedule.category) {
        query = query.eq('category', schedule.category);
      }

      const { data: templates, error: tplErr } = await query;

      if (tplErr) {
        console.error(`[AUTO-SEND] Template query error for "${schedule.name}":`, tplErr);
        continue;
      }

      if (!templates || templates.length === 0) {
        console.log(`[AUTO-SEND] No templates found for "${schedule.name}" (audience: ${schedule.target_audience}, category: ${schedule.category || 'any'})`);
        continue;
      }

      console.log(`[AUTO-SEND] Found ${templates.length} template(s) for "${schedule.name}"`);

      // Pick random template
      const template = templates[Math.floor(Math.random() * templates.length)];

      // Send via broadcast-notification
      try {
        console.log(`[AUTO-SEND] Sending "${template.title}" via broadcast for "${schedule.name}" to target: ${schedule.target_audience}`);

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

        const resultText = await response.text();
        console.log(`[AUTO-SEND] Broadcast response for "${schedule.name}": ${response.status} — ${resultText}`);

        let result;
        try { result = JSON.parse(resultText); } catch { result = {}; }
        
        const sentCount = result.sent || 0;
        totalSent += sentCount;
        schedulesProcessed++;

        // Update last_sent_at regardless so we don't retry the same slot endlessly
        await supabase
          .from('auto_notification_schedules')
          .update({
            last_sent_at: now.toISOString(),
            total_sent: (schedule.total_sent || 0) + sentCount,
            updated_at: now.toISOString(),
          })
          .eq('id', schedule.id);

        console.log(`[AUTO-SEND] ✅ "${schedule.name}" → ${sentCount} sent, last_sent_at updated`);
      } catch (e) {
        console.error(`[AUTO-SEND] ❌ Failed "${schedule.name}":`, e);
      }
    }

    console.log(`[AUTO-SEND] Done — ${schedulesProcessed} schedules processed, ${totalSent} total sent`);

    return new Response(
      JSON.stringify({ schedules_processed: schedulesProcessed, total_sent: totalSent }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('[AUTO-SEND] Fatal error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
