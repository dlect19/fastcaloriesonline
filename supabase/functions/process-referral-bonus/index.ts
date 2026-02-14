import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { orderId } = await req.json();
    if (!orderId) {
      return new Response(JSON.stringify({ error: "orderId required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // Get order
    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, user_id, total, subtotal, payment_status, status, environment, order_number")
      .eq("id", orderId)
      .single();

    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: "Order not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (order.payment_status !== "paid" || order.status === "cancelled") {
      return new Response(JSON.stringify({ skipped: true, reason: "Order not eligible" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check if this is the user's first completed/paid order
    const { count: priorOrders } = await supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("user_id", order.user_id)
      .eq("payment_status", "paid")
      .neq("status", "cancelled")
      .neq("id", orderId);

    if ((priorOrders || 0) > 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "Not first order" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get referral settings
    const { data: settings } = await supabase.from("platform_settings").select("key, value").in("key", [
      "referral_enabled", "referral_referrer_bonus", "referral_new_user_bonus",
      "referral_min_order_amount", "referral_bonus_expiry_days", "referral_daily_limit",
    ]);

    const cfg: Record<string, string> = {};
    settings?.forEach((s) => (cfg[s.key] = s.value));

    if (cfg.referral_enabled !== "true") {
      return new Response(JSON.stringify({ skipped: true, reason: "Referrals disabled" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const minOrder = Number(cfg.referral_min_order_amount) || 2500;
    if (Number(order.total) < minOrder) {
      return new Response(JSON.stringify({ skipped: true, reason: "Order below minimum" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check if user was referred
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, referred_by")
      .eq("user_id", order.user_id)
      .single();

    if (!profile?.referred_by) {
      return new Response(JSON.stringify({ skipped: true, reason: "No referrer" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check if referral already completed
    const { data: existingReferral } = await supabase
      .from("referrals")
      .select("id, status")
      .eq("referred_id", profile.id)
      .single();

    if (!existingReferral) {
      return new Response(JSON.stringify({ skipped: true, reason: "No referral record" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (existingReferral.status === "completed") {
      return new Response(JSON.stringify({ skipped: true, reason: "Already completed" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const referrerBonus = Number(cfg.referral_referrer_bonus) || 300;
    const isTestMode = order.environment === "development";

    // Get referrer's user_id from profile
    const { data: referrerProfile } = await supabase
      .from("profiles")
      .select("id, user_id")
      .eq("id", profile.referred_by)
      .single();

    if (!referrerProfile) {
      return new Response(JSON.stringify({ error: "Referrer profile not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Daily limit check for referrer
    const today = new Date().toISOString().split("T")[0];
    const { count: todayCount } = await supabase
      .from("referrals")
      .select("id", { count: "exact", head: true })
      .eq("referrer_id", referrerProfile.id)
      .eq("status", "completed")
      .gte("completed_at", today + "T00:00:00Z")
      .lte("completed_at", today + "T23:59:59Z");

    const dailyLimit = Number(cfg.referral_daily_limit) || 10;
    if ((todayCount || 0) >= dailyLimit) {
      await supabase.from("referrals").update({ status: "flagged" }).eq("id", existingReferral.id);
      return new Response(JSON.stringify({ skipped: true, reason: "Daily limit reached" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Get platform wallet for recording referral cost
    const { data: platformWallet } = await supabase
      .from("platform_wallet")
      .select("id")
      .limit(1)
      .single();

    const totalBonusCost = referrerBonus;

    // Credit referrer MAIN wallet balance
    const { data: referrerWallet } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", referrerProfile.user_id)
      .eq("wallet_type", "customer")
      .single();

    let referrerWalletId = referrerWallet?.id;
    if (!referrerWalletId) {
      const { data: newW } = await supabase
        .from("wallets")
        .insert({ user_id: referrerProfile.user_id, wallet_type: "customer" })
        .select("id")
        .single();
      referrerWalletId = newW?.id;
    }

    if (referrerWalletId) {
      const balCol = isTestMode ? "test_balance" : "balance";
      const { data: rw } = await supabase.from("wallets").select(balCol).eq("id", referrerWalletId).single();
      const currentBal = Number(rw?.[balCol]) || 0;

      await supabase.from("wallets").update({
        [balCol]: currentBal + referrerBonus,
        updated_at: new Date().toISOString(),
      }).eq("id", referrerWalletId);

      await supabase.from("wallet_transactions").insert({
        wallet_id: referrerWalletId,
        wallet_type: "customer",
        transaction_type: "credit",
        category: "referral_bonus",
        amount: referrerBonus,
        balance_after: currentBal + referrerBonus,
        status: "completed",
        environment: order.environment,
        notes: `Referral bonus - friend completed first order #${order.order_number}`,
      });
    }


    // Record referral cost as platform loss (debit from platform wallet)
    if (platformWallet?.id) {
      // Debit platform wallet for referral bonus cost
      if (isTestMode) {
        await supabase.from("platform_wallet").update({
          test_balance: undefined, // Will use raw SQL approach below
        }).eq("id", "never"); // no-op, use RPC below

        // Use direct update with current balance
        const { data: pw } = await supabase.from("platform_wallet").select("test_balance").eq("id", platformWallet.id).single();
        const currentPlatformBal = Number(pw?.test_balance) || 0;
        await supabase.from("platform_wallet").update({
          test_balance: currentPlatformBal - totalBonusCost,
          updated_at: new Date().toISOString(),
        }).eq("id", platformWallet.id);
      } else {
        const { data: pw } = await supabase.from("platform_wallet").select("balance").eq("id", platformWallet.id).single();
        const currentPlatformBal = Number(pw?.balance) || 0;
        await supabase.from("platform_wallet").update({
          balance: currentPlatformBal - totalBonusCost,
          updated_at: new Date().toISOString(),
        }).eq("id", platformWallet.id);
      }

      // Log referral cost as platform debit transaction
      await supabase.from("wallet_transactions").insert({
        wallet_type: "platform",
        category: "referral_cost",
        transaction_type: "debit",
        amount: totalBonusCost,
        platform_wallet_id: platformWallet.id,
        environment: order.environment,
        status: "completed",
        notes: `Referral bonus cost - Referrer: ₦${referrerBonus} (Order #${order.order_number})`,
        order_id: orderId,
      });
    }

    // Update referral record
    await supabase.from("referrals").update({
      status: "completed",
      trigger_order_id: orderId,
      referrer_bonus: referrerBonus,
      referred_bonus: 0,
      referrer_credited: true,
      referred_credited: false,
      completed_at: new Date().toISOString(),
    }).eq("id", existingReferral.id);

    console.log(`Referral bonus processed: referrer=${referrerProfile.user_id} (+₦${referrerBonus}), platform_cost=₦${totalBonusCost}, order=${orderId}`);

    return new Response(JSON.stringify({
      success: true,
      referrer_bonus: referrerBonus,
      platform_cost: totalBonusCost,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Error processing referral bonus:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
