import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { orderId } = await req.json();
    if (!orderId) return new Response(JSON.stringify({ error: "orderId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Get prescription orders for this order
    const { data: prescriptions } = await supabase
      .from("prescription_orders")
      .select("*, products:product_id(name, pharmacist_dosage_instructions, default_dosage_frequency, default_dosage_duration_days, default_quantity_per_dose)")
      .eq("order_id", orderId);

    if (!prescriptions || prescriptions.length === 0) {
      return new Response(JSON.stringify({ message: "No prescriptions found" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const frequencyToTimes: Record<string, string[]> = {
      once_daily: ["08:00"],
      twice_daily: ["08:00", "20:00"],
      three_times_daily: ["08:00", "14:00", "20:00"],
      four_times_daily: ["08:00", "12:00", "16:00", "20:00"],
      every_6_hours: ["06:00", "12:00", "18:00", "00:00"],
      every_8_hours: ["08:00", "16:00", "00:00"],
      five_times_daily: ["06:00", "10:00", "14:00", "18:00", "22:00"],
      as_needed: ["08:00"],
    };

    const frequencyToTimesPerDay: Record<string, number> = {
      once_daily: 1, twice_daily: 2, three_times_daily: 3, four_times_daily: 4,
      every_6_hours: 4, every_8_hours: 3, five_times_daily: 5, as_needed: 1,
    };

    for (const rx of prescriptions) {
      const product = rx.products as any;
      const drugName = product?.name || "Unknown Drug";
      const freq = rx.dosage_frequency || "twice_daily";
      const duration = rx.dosage_duration_days || 7;
      const qtyPerDose = rx.quantity_per_dose || 1;
      const timesPerDay = frequencyToTimesPerDay[freq] || 1;
      const totalDoses = timesPerDay * duration * qtyPerDose;

      // Create drug usage tracking
      const { data: usage } = await supabase.from("drug_usage_tracking").insert({
        prescription_order_id: rx.id,
        user_id: rx.user_id,
        drug_name: drugName,
        total_doses: totalDoses,
        doses_taken: 0,
        next_dose_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }).select().single();

      // Create drug reminder
      const reminderTimes = frequencyToTimes[freq] || ["08:00"];
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + duration);

      await supabase.from("drug_reminders").insert({
        user_id: rx.user_id,
        drug_name: drugName,
        dosage: `${qtyPerDose} ${qtyPerDose > 1 ? "units" : "unit"}`,
        frequency: freq,
        reminder_times: reminderTimes,
        start_date: new Date().toISOString().split("T")[0],
        end_date: endDate.toISOString().split("T")[0],
        is_active: true,
        prescription_order_id: rx.id,
        drug_usage_tracking_id: usage?.id || null,
      });
    }

    return new Response(JSON.stringify({ success: true, count: prescriptions.length }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
