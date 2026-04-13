import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const now = new Date();
    const currentTime = now.toTimeString().slice(0, 5); // "HH:MM"
    const currentDate = now.toISOString().split("T")[0];

    // Find active reminders where current time matches one of the reminder_times
    // and the reminder is still within the date range
    const { data: reminders, error } = await supabase
      .from("drug_reminders")
      .select("*, drug_usage_tracking:drug_usage_tracking_id(id, doses_taken, total_doses)")
      .eq("is_active", true)
      .lte("start_date", currentDate)
      .gte("end_date", currentDate);

    if (error) throw error;
    if (!reminders || reminders.length === 0) {
      return new Response(JSON.stringify({ message: "No active reminders", checked_at: currentTime }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let sent = 0;
    let skipped = 0;

    for (const reminder of reminders) {
      // Check if current time matches any of the reminder times (within 5 min window)
      const reminderTimes: string[] = reminder.reminder_times || [];
      const isTimeMatch = reminderTimes.some((t: string) => {
        const [rH, rM] = t.split(":").map(Number);
        const [cH, cM] = currentTime.split(":").map(Number);
        const diff = Math.abs((rH * 60 + rM) - (cH * 60 + cM));
        return diff <= 2; // 2-minute window
      });

      if (!isTimeMatch) {
        skipped++;
        continue;
      }

      // Check if already completed all doses
      const tracking = reminder.drug_usage_tracking as any;
      if (tracking && tracking.doses_taken >= tracking.total_doses) {
        skipped++;
        continue;
      }

      const progress = tracking
        ? `${tracking.doses_taken}/${tracking.total_doses} doses taken`
        : "";

      // Send push notification
      try {
        await supabase.functions.invoke("send-push-notification", {
          body: {
            user_id: reminder.user_id,
            title: `💊 Time to take ${reminder.drug_name}`,
            body: `Take ${reminder.dosage}. ${progress}`,
            data: { type: "DRUG_REMINDER", url: "/drug-tracker" },
          },
        });
        sent++;
      } catch (e) {
        console.error(`Failed to send reminder for ${reminder.drug_name}:`, e);
      }
    }

    return new Response(JSON.stringify({ sent, skipped, total: reminders.length, checked_at: currentTime }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Process drug reminders error:", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
