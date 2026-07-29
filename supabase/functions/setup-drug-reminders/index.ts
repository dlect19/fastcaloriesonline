import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

/**
 * Prepares DRAFT medication schedules from a delivered pharmacy order.
 * It never activates reminders and never invents clock times — if the
 * instructions do not state exact times, the customer picks them on review.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { orderId } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: prescriptions } = await supabase
      .from("prescription_orders")
      .select("*, products:product_id(name, strength, pharmacist_dosage_instructions)")
      .eq("order_id", orderId);

    if (!prescriptions || prescriptions.length === 0) {
      return new Response(JSON.stringify({ message: "No prescriptions found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Doses per day implied by the documented frequency. Times are NOT inferred.
    const dosesPerDay: Record<string, number> = {
      once_daily: 1, twice_daily: 2, three_times_daily: 3, four_times_daily: 4,
      every_6_hours: 4, every_8_hours: 3, five_times_daily: 5, as_needed: 1,
    };

    let created = 0;

    for (const rx of prescriptions as any[]) {
      // Idempotent: never prepare a second draft for the same prescription line.
      const { data: existing } = await supabase
        .from("drug_reminders")
        .select("id")
        .eq("prescription_order_id", rx.id)
        .maybeSingle();
      if (existing) continue;

      const product = rx.products as any;
      const drugName = product?.name || "Medication";
      const freq = rx.dosage_frequency || null;
      const duration = rx.dosage_duration_days || null;
      const qtyPerDose = rx.quantity_per_dose || 1;
      const perDay = freq ? (dosesPerDay[freq] ?? null) : null;

      // Explicit times only exist when the prescription records specific slots.
      const explicitTimes: string[] = [];

      const unit = rx.dose_unit || (qtyPerDose > 1 ? "units" : "unit");
      const totalDoses = perDay && duration ? perDay * duration * qtyPerDose : qtyPerDose;

      const { data: usage } = await supabase.from("drug_usage_tracking").insert({
        prescription_order_id: rx.id,
        user_id: rx.user_id,
        drug_name: drugName,
        total_doses: totalDoses,
        doses_taken: 0,
      }).select().single();

      const endDate = duration
        ? new Date(Date.now() + duration * 86400000).toISOString().split("T")[0]
        : null;

      const verified = rx.approval_status === "approved" && rx.approved_by;

      const { error } = await supabase.from("drug_reminders").insert({
        user_id: rx.user_id,
        drug_name: drugName,
        strength: product?.strength ?? null,
        dosage: `${qtyPerDose} ${unit}`,
        instructions: rx.doctor_instructions || rx.pharmacist_instructions || product?.pharmacist_dosage_instructions || null,
        frequency: freq || "as_instructed",
        doses_per_day: perDay,
        reminder_times: explicitTimes,
        times_needed: explicitTimes.length === 0,
        start_date: new Date().toISOString().split("T")[0],
        end_date: endDate,
        // DRAFT: prepared for the customer, but no notification is scheduled yet.
        status: "draft",
        is_active: false,
        source: "pharmacy_order",
        instruction_source: rx.prescription_type === "doctor" ? "doctor_prescription" : "pharmacist_instruction",
        verification_status: verified ? "verified" : "pending_verification",
        verified_by: verified ? rx.approved_by : null,
        verified_at: verified ? rx.approved_at : null,
        prescription_order_id: rx.id,
        drug_usage_tracking_id: usage?.id || null,
      });

      if (!error) created++;
    }

    return new Response(JSON.stringify({ success: true, drafts_prepared: created }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("setup-drug-reminders error", err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
