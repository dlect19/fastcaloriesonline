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

    const minOrder = Number(cfg.referral_min_order_amount) || 2000;
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
    const newUserBonus = Number(cfg.referral_new_user_bonus) || 200;
    const expiryDays = Number(cfg.referral_bonus_expiry_days) || 30;
    const isTestMode = order.environment === "development";
    const expiresAt = new Date(Date.now() + expiryDays * 24 * 60 * 60 * 1000).toISOString();

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

    // Credit referrer wallet
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
      const balCol = isTestMode ? "test_referral_bonus_balance" : "referral_bonus_balance";
      const { data: rw } = await supabase.from("wallets").select(balCol).eq("id", referrerWalletId).single();
      const currentBal = Number(rw?.[balCol]) || 0;

      await supabase.from("wallets").update({
        [balCol]: currentBal + referrerBonus,
        referral_bonus_expires_at: expiresAt,
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

    // Credit referred user wallet
    const { data: referredWallet } = await supabase
      .from("wallets")
      .select("id")
      .eq("user_id", order.user_id)
      .eq("wallet_type", "customer")
      .single();

    let referredWalletId = referredWallet?.id;
    if (!referredWalletId) {
      const { data: newW } = await supabase
        .from("wallets")
        .insert({ user_id: order.user_id, wallet_type: "customer" })
        .select("id")
        .single();
      referredWalletId = newW?.id;
    }

    if (referredWalletId) {
      const balCol = isTestMode ? "test_referral_bonus_balance" : "referral_bonus_balance";
      const { data: rw } = await supabase.from("wallets").select(balCol).eq("id", referredWalletId).single();
      const currentBal = Number(rw?.[balCol]) || 0;

      await supabase.from("wallets").update({
        [balCol]: currentBal + newUserBonus,
        referral_bonus_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }).eq("id", referredWalletId);

      await supabase.from("wallet_transactions").insert({
        wallet_id: referredWalletId,
        wallet_type: "customer",
        transaction_type: "credit",
        category: "referral_bonus",
        amount: newUserBonus,
        balance_after: currentBal + newUserBonus,
        status: "completed",
        environment: order.environment,
        notes: `Welcome bonus for first order #${order.order_number}`,
      });
    }

    // Update referral record
    await supabase.from("referrals").update({
      status: "completed",
      trigger_order_id: orderId,
      referrer_bonus: referrerBonus,
      referred_bonus: newUserBonus,
      referrer_credited: true,
      referred_credited: true,
      completed_at: new Date().toISOString(),
      expires_at: expiresAt,
    }).eq("id", existingReferral.id);

    console.log(`Referral bonus processed: referrer=${referrerProfile.user_id}, referred=${order.user_id}, order=${orderId}`);

    return new Response(JSON.stringify({
      success: true,
      referrer_bonus: referrerBonus,
      referred_bonus: newUserBonus,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    console.error("Error processing referral bonus:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
