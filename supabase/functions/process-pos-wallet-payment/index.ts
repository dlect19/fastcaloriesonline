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

    // Get fee percentage — this is a CUSTOMER-side transaction fee.
    // No vendor commission is taken on POS wallet sales: the vendor is credited
    // the full sale amount, and the customer is debited amount + fee.
    const { data: feeSetting } = await admin
      .from("platform_settings").select("value").eq("key", "pos_wallet_fee_percentage").maybeSingle();
    const feePct = Number(feeSetting?.value ?? 1.5);
    const fee = Math.round((Number(amount) * feePct) / 100);
    const vendorCredit = Number(amount);
    const customerDebit = Number(amount) + fee;

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
    if (customerBal < customerDebit) {
      return new Response(JSON.stringify({ error: `Insufficient wallet balance (needs ₦${customerDebit.toLocaleString()} incl. ₦${fee.toLocaleString()} transaction fee)`, balance: customerBal, required: customerDebit, fee }), {
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
    const customerBalAfter = customerBal - customerDebit;

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

    // Debit customer through the ledger (single source of truth)
    const { error: custErr } = await admin.rpc("post_wallet_entry", {
      p_wallet_id: customerWallet.id,
      p_wallet_type: "customer",
      p_transaction_type: "debit",
      p_category: "pos_purchase",
      p_amount: customerDebit,
      p_reference: reference,
      p_environment: environment,
      p_order_id: orderId,
      p_notes: `In-store purchase at ${vendorName || "vendor"} — ₦${Number(amount).toLocaleString()} + ₦${fee.toLocaleString()} transaction fee (${feePct}%)`,
      p_metadata: { vendor_id: vendorId, outlet_id: outletId ?? null, sale_amount: Number(amount), fee, fee_pct: feePct, fee_payer: "customer", source: "process-pos-wallet-payment" },
    });
    if (custErr) {
      console.error("[pos-wallet] customer debit failed:", custErr.message);
      await admin.from("pos_wallet_auth_codes").update({ used_at: null, used_by_vendor_id: null, used_for_order_id: null }).eq("id", codeRow.id);
      return new Response(JSON.stringify({ error: "Payment failed: " + custErr.message }), {
        status: 500, headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // Credit vendor the FULL sale amount (no vendor commission on POS wallet sales)
    const { error: vendErr } = await admin.rpc("post_wallet_entry", {
      p_wallet_id: vendorWallet.id,
      p_wallet_type: "vendor",
      p_transaction_type: "credit",
      p_category: "pos_sale",
      p_amount: vendorCredit,
      p_reference: `${reference}-V`,
      p_environment: environment,
      p_order_id: orderId,
      p_notes: `POS wallet sale — ₦${Number(amount).toLocaleString()} (no commission; ₦${fee.toLocaleString()} fee paid by customer)`,
      p_metadata: { gross: Number(amount), fee, fee_pct: feePct, fee_payer: "customer", source: "process-pos-wallet-payment" },
    });
    if (vendErr) console.error("[pos-wallet] vendor credit failed:", vendErr.message);

    // Platform earns the customer transaction fee
    if (fee > 0) {
      const { error: platErr } = await admin.rpc("post_platform_entry", {
        p_amount: fee,
        p_category: "pos_wallet_fee",
        p_transaction_type: "credit",
        p_reference: `${reference}-FEE`,
        p_environment: environment,
        p_status: "completed",
        p_notes: `POS wallet transaction fee (${feePct}%) on ₦${Number(amount).toLocaleString()} sale`,
        p_metadata: { order_id: orderId, vendor_id: vendorId, outlet_id: outletId ?? null, sale_amount: Number(amount), fee_pct: feePct, source: "process-pos-wallet-payment" },
      });
      if (platErr) console.error("[pos-wallet] platform fee entry failed:", platErr.message);
    }

    // Keep the vendor's withdrawal-eligible bucket in sync (ledger already moved balance)
    if (!vendErr && vendorCredit > 0) {
      const eligField = isTest ? "test_eligible_balance" : "eligible_balance";
      const { data: freshVendor } = await admin
        .from("wallets").select("eligible_balance, test_eligible_balance").eq("id", vendorWallet.id).maybeSingle();
      const eligBefore = Number((isTest ? freshVendor?.test_eligible_balance : freshVendor?.eligible_balance) ?? 0);
      await admin.from("wallets").update({
        [eligField]: eligBefore + vendorCredit,
        updated_at: new Date().toISOString(),
      }).eq("id", vendorWallet.id);
    }

    const { data: freshCustomer } = await admin
      .from("wallets").select("balance, test_balance").eq("id", customerWallet.id).maybeSingle();
    const customerBalanceAfter = Number((isTest ? freshCustomer?.test_balance : freshCustomer?.balance) ?? customerBalAfter);

    return new Response(JSON.stringify({
      success: true,
      reference,
      amount: Number(amount),
      fee,
      total_debited: customerDebit,
      vendor_credit: vendorCredit,
      customer_balance: customerBalanceAfter,
    }), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } });

  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("process-pos-wallet-payment error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
});
