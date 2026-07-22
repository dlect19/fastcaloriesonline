import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
type Sb = any;

async function getPaystackKey(sb: Sb) {
  const { data } = await sb.from("platform_settings").select("value").eq("key", "platform_environment").maybeSingle();
  const env = (data?.value as string) || "development";
  const key = env === "production"
    ? Deno.env.get("PAYSTACK_LIVE_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!
    : Deno.env.get("PAYSTACK_TEST_SECRET_KEY") || Deno.env.get("PAYSTACK_SECRET_KEY")!;
  return { key, env };
}

// Inline fulfilment — mirrors handleVoucherGuestPurchase in paystack-webhook so the
// success page can confirm immediately without waiting for the async webhook.
async function fulfilVoucherPurchase(admin: Sb, tx: any, reference: string) {
  const metadata = tx.metadata || {};
  if (metadata.type !== "voucher_purchase") return { ok: false, reason: "not_voucher" };
  const categoryId = metadata.category_id as string;
  if (!categoryId) return { ok: false, reason: "missing_category" };

  const { data: existing } = await admin
    .from("voucher_orders").select("id").eq("paystack_reference", reference).maybeSingle();
  if (existing) return { ok: true, orderId: (existing as any).id };

  const { data: category } = await admin
    .from("voucher_categories")
    .select("id, name, vendor_id, validity_days, is_active")
    .eq("id", categoryId).maybeSingle();
  if (!category) return { ok: false, reason: "category_missing" };

  const { data: candidate } = await admin
    .from("voucher_codes").select("id, code, value")
    .eq("category_id", categoryId).eq("status", "available")
    .order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!candidate) return { ok: false, reason: "out_of_stock" };

  const { data: reserved } = await admin
    .from("voucher_codes")
    .update({ status: "sold", sold_at: new Date().toISOString() })
    .eq("id", (candidate as any).id).eq("status", "available")
    .select("id, code, value").maybeSingle();
  if (!reserved) return { ok: false, reason: "race_lost" };

  const codeValue = Number((reserved as any).value) || (Number(tx.amount) / 100);
  const { data: rateData } = await admin.rpc("get_vendor_voucher_commission", { _vendor_id: (category as any).vendor_id });
  const commissionRate = Number(rateData ?? 10);
  const commissionAmount = +(codeValue * commissionRate / 100).toFixed(2);
  const purchasedAt = new Date();
  const expiryDate = new Date(purchasedAt.getTime() + (category as any).validity_days * 86400000);

  const { data: order, error: orderErr } = await admin.from("voucher_orders").insert({
    buyer_user_id: null,
    guest_email: metadata.guest_email || tx.customer?.email || null,
    guest_phone: metadata.guest_phone || null,
    guest_name: metadata.guest_name || null,
    vendor_id: (category as any).vendor_id,
    category_id: (category as any).id,
    code_id: (reserved as any).id,
    amount: codeValue,
    commission_amount: commissionAmount,
    commission_rate: commissionRate,
    expiry_date: expiryDate.toISOString(),
    purchased_at: purchasedAt.toISOString(),
    status: "paid",
    paystack_reference: reference,
  }).select().maybeSingle();

  if (orderErr || !order) {
    await admin.from("voucher_codes").update({ status: "available", sold_at: null }).eq("id", (reserved as any).id);
    return { ok: false, reason: "insert_failed" };
  }
  await admin.from("voucher_codes").update({ order_id: (order as any).id }).eq("id", (reserved as any).id);
  await admin.rpc("credit_vendor_wallet_for_voucher", { _order_id: (order as any).id }).catch(() => {});
  return { ok: true, orderId: (order as any).id };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const reference = url.searchParams.get("ref");
    if (!reference) return json({ error: "ref required" }, 400);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let { data: order } = await admin
      .from("voucher_orders")
      .select("id, vendor_id, category_id, code_id, amount, expiry_date, purchased_at, status, guest_email")
      .eq("paystack_reference", reference).maybeSingle();

    // Fallback: webhook hasn't fired yet — verify with Paystack directly and fulfil.
    if (!order) {
      try {
        const { key } = await getPaystackKey(admin);
        const vr = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
          headers: { Authorization: `Bearer ${key}` },
        });
        const vb = await vr.json();
        if (vb?.status && vb?.data?.status === "success") {
          await fulfilVoucherPurchase(admin, vb.data, reference);
          const retry = await admin
            .from("voucher_orders")
            .select("id, vendor_id, category_id, code_id, amount, expiry_date, purchased_at, status, guest_email")
            .eq("paystack_reference", reference).maybeSingle();
          order = retry.data as any;
        }
      } catch (e) {
        console.error("paystack verify fallback failed:", e);
      }
    }

    if (!order) return json({ pending: true });

    const [{ data: code }, { data: category }, { data: vendor }] = await Promise.all([
      admin.from("voucher_codes").select("code").eq("id", (order as any).code_id).maybeSingle(),
      admin.from("voucher_categories").select("name").eq("id", (order as any).category_id).maybeSingle(),
      admin.from("vendors").select("name, logo_url").eq("id", (order as any).vendor_id).maybeSingle(),
    ]);

    const { data: template } = await admin
      .from("vendor_templates")
      .select("logo_url, background_color, background_image_url")
      .eq("vendor_id", (order as any).vendor_id)
      .maybeSingle();

    return json({
      pending: false,
      order,
      code: (code as any)?.code,
      category_name: (category as any)?.name,
      vendor: vendor,
      template: template || null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("voucher-guest-lookup error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}
