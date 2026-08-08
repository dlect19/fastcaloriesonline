import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { sendVoucherEmailForOrder } from "../_shared/voucher-email.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { categoryId } = await req.json();
    if (!categoryId) return json({ error: "categoryId required" }, 400);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: "Invalid token" }, 401);

    const { data: category } = await admin
      .from("voucher_categories")
      .select("id, name, vendor_id, validity_days, is_active")
      .eq("id", categoryId)
      .maybeSingle();
    if (!category || !category.is_active) return json({ error: "Category not available" }, 404);

    const { data: candidate } = await admin
      .from("voucher_codes")
      .select("id, code, value")
      .eq("category_id", categoryId)
      .eq("status", "available")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!candidate) return json({ error: "Out of stock" }, 409);

    const { data: reserved, error: reserveErr } = await admin
      .from("voucher_codes")
      .update({ status: "sold", sold_at: new Date().toISOString() })
      .eq("id", candidate.id)
      .eq("status", "available")
      .select("id, code, value")
      .maybeSingle();
    if (reserveErr || !reserved) return json({ error: "Code was just taken, try again" }, 409);

    const amount = Number(reserved.value);

    const { data: rateData } = await admin.rpc("get_vendor_voucher_commission", { _vendor_id: category.vendor_id });
    const commissionRate = Number(rateData ?? 10);
    const commissionAmount = +(amount * commissionRate / 100).toFixed(2);

    const { data: envSetting } = await admin
      .from("platform_settings").select("value").eq("key", "platform_environment").maybeSingle();
    const environment = envSetting?.value || "development";
    const isTest = environment === "development";

    const { data: wallet } = await admin
      .from("wallets").select("*").eq("user_id", user.id).eq("wallet_type", "customer").maybeSingle();
    if (!wallet) { await releaseCode(admin, reserved.id); return json({ error: "Wallet not found" }, 404); }
    if (wallet.is_disabled) { await releaseCode(admin, reserved.id); return json({ error: "Wallet disabled" }, 403); }

    const balance = isTest ? Number(wallet.test_balance) || 0 : Number(wallet.balance) || 0;
    if (balance < amount) {
      await releaseCode(admin, reserved.id);
      return json({ error: "Insufficient wallet balance", balance, required: amount }, 400);
    }

    const purchasedAt = new Date();
    const expiryDate = new Date(purchasedAt.getTime() + category.validity_days * 24 * 60 * 60 * 1000);

    const { data: order, error: orderErr } = await admin
      .from("voucher_orders")
      .insert({
        buyer_user_id: user.id,
        vendor_id: category.vendor_id,
        category_id: category.id,
        code_id: reserved.id,
        amount,
        commission_amount: commissionAmount,
        commission_rate: commissionRate,
        expiry_date: expiryDate.toISOString(),
        purchased_at: purchasedAt.toISOString(),
        status: "paid",
      })
      .select()
      .maybeSingle();

    if (orderErr || !order) { await releaseCode(admin, reserved.id); return json({ error: "Failed to create order" }, 500); }

    await admin.from("voucher_codes").update({ order_id: order.id }).eq("id", reserved.id);

    // Debit buyer wallet through the ledger (single source of truth)
    const reference = `VH-${order.id}`;
    const { error: debitErr } = await admin.rpc("post_wallet_entry", {
      p_wallet_id: wallet.id,
      p_wallet_type: "customer",
      p_transaction_type: "debit",
      p_category: "voucher_purchase",
      p_amount: amount,
      p_reference: reference,
      p_environment: environment,
      p_notes: `Voucher purchase (${category.name})`,
      p_metadata: {
        voucher_order_id: order.id,
        category_id: category.id,
        vendor_id: category.vendor_id,
        source: "purchase-voucher",
      },
    });
    if (debitErr) {
      console.error("purchase-voucher debit failed:", debitErr.message);
      await admin.from("voucher_orders").update({ status: "failed" }).eq("id", order.id);
      await releaseCode(admin, reserved.id);
      return json({ error: "Payment could not be completed: " + debitErr.message }, 500);
    }
    const { data: freshWallet } = await admin
      .from("wallets").select("balance, test_balance").eq("id", wallet.id).maybeSingle();
    const newBalance = Number((isTest ? freshWallet?.test_balance : freshWallet?.balance) ?? balance - amount);


    // Credit vendor wallet through the standard withdrawal-eligible pipeline
    const { error: creditErr } = await admin.rpc("credit_vendor_wallet_for_voucher", { _order_id: order.id });
    if (creditErr) console.error("credit_vendor_wallet_for_voucher failed:", creditErr);

    // Send voucher confirmation email (async, never blocks response)
    const buyerEmail = user.email || "";
    const buyerName = (user.user_metadata?.full_name as string) || null;
    if (buyerEmail) {
      await sendVoucherEmailForOrder(admin, order.id, buyerEmail, buyerName);
    }

    return json({
      success: true,
      order,
      code: reserved.code,
      expiry_date: expiryDate.toISOString(),
      new_balance: newBalance,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("purchase-voucher error:", msg);
    return json({ error: msg }, 500);
  }
});

async function releaseCode(admin: ReturnType<typeof createClient>, codeId: string) {
  await admin.from("voucher_codes").update({ status: "available", sold_at: null }).eq("id", codeId);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}
