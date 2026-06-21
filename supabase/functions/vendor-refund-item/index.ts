// Vendor "Mark item unavailable & refund" — refunds a single order_item back
// to the customer's wallet, recalculates order totals, and flips the product
// to unavailable so it disappears from the menu until re-enabled.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { orderItemId, reason } = await req.json();
    if (!orderItemId) {
      return json({ error: "orderItemId is required" }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: "Invalid token" }, 401);

    // Load item + order + addons
    const { data: item, error: itemErr } = await admin
      .from("order_items")
      .select("*")
      .eq("id", orderItemId)
      .single();
    if (itemErr || !item) return json({ error: "Order item not found" }, 404);

    if (item.is_refunded) {
      return json({ success: true, already_refunded: true, message: "Item already refunded" });
    }

    const { data: order, error: orderErr } = await admin
      .from("orders")
      .select("*")
      .eq("id", item.order_id)
      .single();
    if (orderErr || !order) return json({ error: "Order not found" }, 404);

    // Authorize: order vendor owner OR active staff OR admin
    let authorized = false;
    const { data: adminRole } = await admin
      .from("user_roles").select("role").eq("user_id", user.id).eq("role", "admin").maybeSingle();
    if (adminRole) authorized = true;
    if (!authorized) {
      const { data: vendor } = await admin
        .from("vendors").select("id").eq("id", order.vendor_id).eq("user_id", user.id).maybeSingle();
      if (vendor) authorized = true;
    }
    if (!authorized) {
      const { data: staff } = await admin
        .from("vendor_staff").select("id")
        .eq("vendor_id", order.vendor_id).eq("user_id", user.id).eq("is_active", true).maybeSingle();
      if (staff) authorized = true;
    }
    if (!authorized) return json({ error: "Not authorized for this order" }, 403);

    // Compute refund amount for the item (item total already includes its add-ons)
    const refundAmount = Number(item.total_price) || 0;
    if (refundAmount <= 0) return json({ error: "Item has no refundable amount" }, 400);

    // Environment for wallet column choice
    const { data: envSetting } = await admin
      .from("platform_settings").select("value").eq("key", "platform_environment").single();
    const environment = envSetting?.value || "development";
    const isTest = environment === "development";

    // Credit customer wallet only if order was paid AND has a customer
    let refundedToWallet = false;
    let newBalance: number | null = null;
    const reference = `RI-${item.id.slice(0, 8)}-${Date.now()}`;

    if (order.payment_status === "paid" && order.user_id) {
      let { data: wallet } = await admin
        .from("wallets").select("*").eq("user_id", order.user_id).eq("wallet_type", "customer").maybeSingle();
      if (!wallet) {
        const { data: w } = await admin.from("wallets")
          .insert({ user_id: order.user_id, wallet_type: "customer" }).select().single();
        wallet = w;
      }
      if (wallet) {
        const current = isTest ? Number(wallet.test_balance) || 0 : Number(wallet.balance) || 0;
        newBalance = current + refundAmount;
        await admin.from("wallets").update(
          isTest ? { test_balance: newBalance, updated_at: new Date().toISOString() }
                 : { balance: newBalance, updated_at: new Date().toISOString() }
        ).eq("id", wallet.id);

        await admin.from("wallet_transactions").insert({
          wallet_id: wallet.id,
          wallet_type: "customer",
          transaction_type: "credit",
          category: "refund",
          amount: refundAmount,
          balance_after: newBalance,
          reference,
          order_id: order.id,
          status: "completed",
          environment,
          notes: reason || `Item refund: ${item.product_name} (#${order.order_number})`,
          metadata: {
            refunded_by: user.id,
            order_item_id: item.id,
            product_id: item.product_id,
            product_name: item.product_name,
            quantity: item.quantity,
            reason: "item_unavailable",
          },
        });
        refundedToWallet = true;
      }
    }

    // Mark item as refunded (kept in order for audit)
    await admin.from("order_items").update({
      is_refunded: true,
      refunded_at: new Date().toISOString(),
      refund_reference: reference,
      refund_amount: refundAmount,
    }).eq("id", item.id);

    // Auto-mark the product unavailable (best-effort)
    if (item.product_id) {
      await admin.from("products").update({ is_available: false }).eq("id", item.product_id);
    }

    // Recalculate order totals from remaining (non-refunded) items
    const { data: remainingItems } = await admin
      .from("order_items").select("total_price").eq("order_id", order.id).eq("is_refunded", false);
    const newSubtotal = (remainingItems || []).reduce((s, r) => s + Number(r.total_price || 0), 0);

    // Keep fees + discount the same; recompute total = subtotal + delivery + service + packaging + extra_pkg - discount
    const newTotal = Math.max(0,
      newSubtotal
      + Number(order.delivery_fee || 0)
      + Number(order.service_fee || 0)
      + Number(order.packaging_fee || 0)
      + Number(order.extra_package_fee || 0)
      - Number(order.discount || 0)
    );

    await admin.from("orders").update({
      subtotal: newSubtotal,
      menu_subtotal: newSubtotal,
      total: newTotal,
      updated_at: new Date().toISOString(),
    }).eq("id", order.id);

    console.log(`[vendor-refund-item] ${reference} order=${order.order_number} item=${item.product_name} amount=₦${refundAmount} refundedToWallet=${refundedToWallet}`);

    return json({
      success: true,
      reference,
      refund_amount: refundAmount,
      refunded_to_wallet: refundedToWallet,
      new_balance: newBalance,
      new_order_subtotal: newSubtotal,
      new_order_total: newTotal,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error("[vendor-refund-item] error:", msg);
    return json({ error: msg }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
