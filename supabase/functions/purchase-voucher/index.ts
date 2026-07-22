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
    const { categoryId } = await req.json();
    if (!categoryId) {
      return json({ error: "categoryId required" }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: "Invalid token" }, 401);

    // Load category + vendor
    const { data: category } = await admin
      .from("voucher_categories")
      .select("id, name, vendor_id, validity_days, is_active")
      .eq("id", categoryId)
      .maybeSingle();
    if (!category || !category.is_active) return json({ error: "Category not available" }, 404);

    // Pick one available code (no strict row-lock in supabase-js; rely on unique code status update)
    const { data: candidate } = await admin
      .from("voucher_codes")
      .select("id, code, value")
      .eq("category_id", categoryId)
      .eq("status", "available")
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!candidate) return json({ error: "Out of stock" }, 409);

    // Reserve the code atomically: only succeeds if still 'available'
    const { data: reserved, error: reserveErr } = await admin
      .from("voucher_codes")
      .update({ status: "sold", sold_at: new Date().toISOString() })
      .eq("id", candidate.id)
      .eq("status", "available")
      .select("id, code, value")
      .maybeSingle();
    if (reserveErr || !reserved) return json({ error: "Code was just taken, try again" }, 409);

    const amount = Number(reserved.value);

    // Effective commission %
    const { data: rateData } = await admin.rpc("get_vendor_voucher_commission", { _vendor_id: category.vendor_id });
    const commissionRate = Number(rateData ?? 10);
    const commissionAmount = +(amount * commissionRate / 100).toFixed(2);

    // Wallet debit
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

    // Create voucher order first
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

    // Link code -> order
    await admin.from("voucher_codes").update({ order_id: order.id }).eq("id", reserved.id);

    // Debit wallet + ledger entry
    const newBalance = balance - amount;
    const reference = `VH-${order.id.slice(0, 8)}-${Date.now()}`;
    await admin.from("wallet_transactions").insert({
      wallet_id: wallet.id,
      wallet_type: "customer",
      transaction_type: "debit",
      category: "voucher_purchase",
      amount,
      balance_after: newBalance,
      reference,
      status: "completed",
      environment,
      notes: `Voucher purchase (${category.name})`,
    });
    if (isTest) {
      await admin.from("wallets").update({ test_balance: newBalance, updated_at: new Date().toISOString() }).eq("id", wallet.id);
    } else {
      await admin.from("wallets").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("id", wallet.id);
    }

    // Ensure vendor wallet row exists (Phase 2 will credit it)
    await admin.from("vendor_wallets").upsert({ vendor_id: category.vendor_id }, { onConflict: "vendor_id" });

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
