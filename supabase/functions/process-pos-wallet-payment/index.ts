import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { customerUserId, code, amount, vendorId, outletId, orderId, vendorName } = await req.json();

    if (!customerUserId || !code || !amount || !vendorId || !orderId) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Authenticate vendor user
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), {
        status: 401, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Verify code: active, unused, not expired, matches customer
    const cleanCode = String(code).trim();
    const { data: codeRow, error: codeErr } = await admin
      .from("pos_wallet_auth_codes")
      .select("id, expires_at, used_at")
      .eq("user_id", customerUserId)
      .eq("code", cleanCode)
      .is("used_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();

    if (codeErr || !codeRow) {
      return new Response(JSON.stringify({ error: "Invalid or expired authorization code" }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Get environment
    const { data: envSetting } = await admin
      .from("platform_settings").select("value").eq("key", "platform_environment").maybeSingle();
    const environment = envSetting?.value || "production";
    const isTest = environment === "development";

    // Get fee percentage
    const { data: feeSetting } = await admin
      .from("platform_settings").select("value").eq("key", "pos_wallet_fee_percentage").maybeSingle();
    const feePct = Number(feeSetting?.value ?? 1.5);
    const fee = Math.round((Number(amount) * feePct) / 100);
    const vendorCredit = Number(amount) - fee;

    // Get customer wallet
    const { data: customerWallet, error: cwErr } = await admin
      .from("wallets").select("*")
      .eq("user_id", customerUserId).eq("wallet_type", "customer").maybeSingle();
    if (cwErr || !customerWallet) {
      return new Response(JSON.stringify({ error: "Customer wallet not found" }), {
        status: 404, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    if (customerWallet.is_disabled) {
      return new Response(JSON.stringify({ error: "Customer wallet disabled" }), {
        status: 403, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    const customerBal = isTest ? Number(customerWallet.test_balance) || 0 : Number(customerWallet.balance) || 0;
    if (customerBal < Number(amount)) {
      return new Response(JSON.stringify({ error: "Insufficient wallet balance", balance: customerBal }), {
        status: 400, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Vendor wallet — find by user/outlet
    let vwQuery = admin.from("wallets").select("*").eq("wallet_type", "vendor");
    // Resolve vendor user_id from vendors
    const { data: vendorRow } = await admin.from("vendors").select("user_id").eq("id", vendorId).maybeSingle();
    if (!vendorRow) {
      return new Response(JSON.stringify({ error: "Vendor not found" }), {
        status: 404, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }
    vwQuery = vwQuery.eq("user_id", vendorRow.user_id);
    if (outletId) vwQuery = vwQuery.eq("outlet_id", outletId);
    const { data: vendorWallets } = await vwQuery;
    const vendorWallet = vendorWallets?.[0];
    if (!vendorWallet) {
      return new Response(JSON.stringify({ error: "Vendor wallet not found" }), {
        status: 404, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    const reference = `POS-${orderId.slice(0, 8)}-${Date.now()}`;
    const customerBalAfter = customerBal - Number(amount);

    // Mark code used FIRST (idempotency)
    const { error: markErr } = await admin
      .from("pos_wallet_auth_codes")
      .update({ used_at: new Date().toISOString(), used_by_vendor_id: vendorId, used_for_order_id: orderId })
      .eq("id", codeRow.id).is("used_at", null);
    if (markErr) {
      return new Response(JSON.stringify({ error: "Code already used" }), {
        status: 409, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Debit customer ledger
    await admin.from("wallet_transactions").insert({
      wallet_id: customerWallet.id,
      wallet_type: "customer",
      transaction_type: "debit",
      category: "pos_purchase",
      amount: Number(amount),
      balance_after: customerBalAfter,
      reference,
      order_id: orderId,
      status: "completed",
      environment,
      notes: `In-store purchase at ${vendorName || "vendor"} (fee ₦${fee.toLocaleString()})`,
    });

    // Update customer wallet balance
    if (isTest) {
      await admin.from("wallets").update({ test_balance: customerBalAfter, updated_at: new Date().toISOString() }).eq("id", customerWallet.id);
    } else {
      await admin.from("wallets").update({ balance: customerBalAfter, updated_at: new Date().toISOString() }).eq("id", customerWallet.id);
    }

    // Credit vendor (net of fee)
    const vendorBalBefore = isTest ? Number(vendorWallet.test_balance) || 0 : Number(vendorWallet.balance) || 0;
    const vendorEligBefore = isTest ? Number(vendorWallet.test_eligible_balance) || 0 : Number(vendorWallet.eligible_balance) || 0;
    const vendorBalAfter = vendorBalBefore + vendorCredit;
    const vendorEligAfter = vendorEligBefore + vendorCredit;

    await admin.from("wallet_transactions").insert({
      wallet_id: vendorWallet.id,
      wallet_type: "vendor",
      transaction_type: "credit",
      category: "pos_sale",
      amount: vendorCredit,
      balance_after: vendorBalAfter,
      reference,
      order_id: orderId,
      status: "completed",
      environment,
      notes: `POS sale — gross ₦${Number(amount).toLocaleString()}, platform fee ₦${fee.toLocaleString()} (${feePct}%)`,
    });

    if (isTest) {
      await admin.from("wallets").update({
        test_balance: vendorBalAfter,
        test_eligible_balance: vendorEligAfter,
        updated_at: new Date().toISOString(),
      }).eq("id", vendorWallet.id);
    } else {
      await admin.from("wallets").update({
        balance: vendorBalAfter,
        eligible_balance: vendorEligAfter,
        updated_at: new Date().toISOString(),
      }).eq("id", vendorWallet.id);
    }

    // Log platform fee revenue (no wallet, just ledger for tracking)
    if (fee > 0) {
      await admin.from("wallet_transactions").insert({
        wallet_id: vendorWallet.id,
        wallet_type: "vendor",
        transaction_type: "debit",
        category: "pos_platform_fee",
        amount: 0, // not affecting balance — informational
        balance_after: vendorBalAfter,
        reference: `${reference}-FEE`,
        order_id: orderId,
        status: "completed",
        environment,
        notes: `Platform service fee ₦${fee.toLocaleString()} (${feePct}%) retained on POS wallet payment`,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      reference,
      amount: Number(amount),
      fee,
      vendor_credit: vendorCredit,
      customer_balance: customerBalAfter,
    }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("process-pos-wallet-payment error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
});
