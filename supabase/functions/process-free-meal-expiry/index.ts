import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceKey);

    const now = new Date().toISOString();

    // Find audit records where period has expired and status is still in_progress or qualified
    const { data: expiredRecords, error: fetchError } = await supabase
      .from("free_meal_audit")
      .select("*")
      .in("status", ["in_progress", "qualified"])
      .lt("period_end", now);

    if (fetchError) throw fetchError;

    let expiredCount = 0;
    let returnedAmount = 0;

    for (const record of expiredRecords || []) {
      // Mark as expired
      await supabase
        .from("free_meal_audit")
        .update({
          status: "expired",
          expired_at: now,
          notes: `${record.notes || ""} | Expired without claim - ₦${record.platform_cost} returned to platform profit`,
          updated_at: now,
        })
        .eq("id", record.id);

      expiredCount++;
      returnedAmount += record.platform_cost;
    }

    // Process claimed records that need vendor payment
    const { data: claimedRecords, error: claimedError } = await supabase
      .from("free_meal_audit")
      .select("*, free_meal_promos!inner(vendor_id, vendor_name)")
      .eq("status", "claimed");

    if (claimedError) throw claimedError;

    let vendorPaidCount = 0;
    let vendorPaidAmount = 0;

    for (const record of claimedRecords || []) {
      const vendorId = (record as any).free_meal_promos?.vendor_id;
      if (!vendorId) continue;

      // Get vendor's user_id
      const { data: vendor } = await supabase
        .from("vendors")
        .select("user_id")
        .eq("id", vendorId)
        .single();

      if (!vendor) continue;

      // Get vendor wallet
      const { data: wallet } = await supabase
        .from("wallets")
        .select("id")
        .eq("user_id", vendor.user_id)
        .eq("wallet_type", "vendor")
        .limit(1)
        .single();

      if (!wallet) continue;

      // Credit vendor wallet for the free meal value
      const mealValue = record.vendor_credit || record.meal_value;

      // Post vendor credit through the single safe ledger entry point
      const { error: postErr } = await supabase.rpc("post_wallet_entry", {
        p_wallet_id: wallet.id,
        p_wallet_type: "vendor",
        p_transaction_type: "credit",
        p_category: "vendor_share",
        p_amount: mealValue,
        p_reference: `FREEMEAL-VENDOR-${record.id}`,
        p_environment: record.environment || "production",
        p_notes: `Free meal vendor payment - ${record.notes || ""}`,
        p_metadata: {
          free_meal_audit_id: record.id,
          promo_id: record.promo_id,
          type: "free_meal_vendor_credit",
          source: "process-free-meal-expiry",
        },
      });

      if (postErr) {
        console.error("[free-meal-expiry] post_wallet_entry failed:", postErr.message);
        continue;
      }


      // Mark audit as vendor_paid
      await supabase
        .from("free_meal_audit")
        .update({
          status: "vendor_paid",
          vendor_paid_at: now,
          notes: `${record.notes || ""} | Vendor paid ₦${mealValue}`,
          updated_at: now,
        })
        .eq("id", record.id);

      // Debit platform ledger for the free-meal cost
      const { error: platErr } = await supabase.rpc("post_platform_entry", {
        p_amount: mealValue,
        p_category: "free_meal_cost",
        p_transaction_type: "debit",
        p_reference: `FM-COST-${record.id}`,
        p_environment: record.environment || "production",
        p_status: "completed",
        p_notes: `Free meal cost - vendor payment for ${(record as any).free_meal_promos?.vendor_name || "vendor"}`,
        p_metadata: {
          free_meal_audit_id: record.id,
          promo_id: record.promo_id,
          source: "process-free-meal-expiry",
        },
      });
      if (platErr) console.error("[free-meal-expiry] post_platform_entry failed:", platErr.message);


      vendorPaidCount++;
      vendorPaidAmount += mealValue;
    }

    return new Response(
      JSON.stringify({
        success: true,
        expired: { count: expiredCount, returned_amount: returnedAmount },
        vendor_paid: { count: vendorPaidCount, amount: vendorPaidAmount },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error processing free meal expiry:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
