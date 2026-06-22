// Vendor item/add-on actions:
//   - Refund a single order_item (with all its add-ons) back to the customer wallet
//   - Refund a single order_item_addon
//   - Record a substitute (same price OR with partial refund) and notify the
//     customer via the order chat thread.
// Always recalculates order subtotal/total and (for item refunds) flips the
// product to unavailable in the menu.
import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Body = {
  orderItemId?: string;
  addonId?: string;
  // Action: "refund" (default) or "substitute"
  action?: "refund" | "substitute";
  // Substitute fields
  substituteName?: string;
  substituteNote?: string;
  // Optional partial refund alongside substitute (e.g. cheaper replacement) — total amount
  substituteRefundAmount?: number;
  // For item substitutes only: how many portions of the line to substitute.
  // Defaults to the full line quantity. When < line quantity, the row is split
  // so the remaining portions stay as the original item.
  substituteQuantity?: number;
  reason?: string;
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;
    const action = body.action || "refund";

    if (!body.orderItemId && !body.addonId) {
      return json({ error: "orderItemId or addonId is required" }, 400);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !user) return json({ error: "Invalid token" }, 401);

    // Resolve target order item (either directly or via addon)
    let addon: any = null;
    let orderItemId = body.orderItemId;
    if (body.addonId) {
      const { data: a } = await admin
        .from("order_item_addons").select("*").eq("id", body.addonId).maybeSingle();
      if (!a) return json({ error: "Add-on not found" }, 404);
      addon = a;
      orderItemId = a.order_item_id;
    }

    const { data: item, error: itemErr } = await admin
      .from("order_items").select("*").eq("id", orderItemId!).single();
    if (itemErr || !item) return json({ error: "Order item not found" }, 404);

    const { data: order, error: orderErr } = await admin
      .from("orders").select("*").eq("id", item.order_id).single();
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

    // Environment for wallet column choice
    const { data: envSetting } = await admin
      .from("platform_settings").select("value").eq("key", "platform_environment").single();
    const environment = envSetting?.value || "development";
    const isTest = environment === "development";

    // ---- Compute refund amount based on what we're acting on ----
    let refundAmount = 0;
    let scope: "item" | "addon" = "item";
    let displayName = "";

    if (addon) {
      scope = "addon";
      displayName = addon.addon_item_name || "add-on";
      if (action === "refund") {
        if (addon.is_refunded) {
          return json({ success: true, already_refunded: true, message: "Add-on already refunded" });
        }
        // qty of parent item × addon price
        refundAmount = Number(addon.additional_price || 0) * Number(item.quantity || 1);
      } else if (action === "substitute") {
        refundAmount = Math.max(0, Number(body.substituteRefundAmount || 0));
      }
    } else {
      scope = "item";
      displayName = item.product_name || "item";
      if (action === "refund") {
        if (item.is_refunded) {
          return json({ success: true, already_refunded: true, message: "Item already refunded" });
        }
        refundAmount = Number(item.total_price) || 0; // includes its add-ons
      } else if (action === "substitute") {
        refundAmount = Math.max(0, Number(body.substituteRefundAmount || 0));
      }
    }

    // For substitute, refund amount may legitimately be 0 (same price)
    if (action === "refund" && refundAmount <= 0) {
      return json({ error: "Nothing refundable for this selection" }, 400);
    }

    // ---- Credit wallet (only if paid order, has customer, refund > 0) ----
    let refundedToWallet = false;
    let newBalance: number | null = null;
    const reference = `${scope === "addon" ? "RA" : "RI"}-${(addon?.id || item.id).slice(0, 8)}-${Date.now()}`;

    if (refundAmount > 0 && order.payment_status === "paid" && order.user_id) {
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
          notes: body.reason ||
            (action === "substitute"
              ? `Substitute partial refund: ${displayName} (#${order.order_number})`
              : `${scope === "addon" ? "Add-on" : "Item"} refund: ${displayName} (#${order.order_number})`),
          metadata: {
            refunded_by: user.id,
            order_item_id: item.id,
            addon_id: addon?.id || null,
            product_id: item.product_id,
            product_name: item.product_name,
            scope,
            action,
            substitute_name: body.substituteName || null,
          },
        });
        refundedToWallet = true;
      }
    }

    // ---- Apply DB changes ----
    if (action === "refund") {
      if (scope === "addon") {
        await admin.from("order_item_addons").update({
          is_refunded: true,
          refunded_at: new Date().toISOString(),
          refund_reference: reference,
          refund_amount: refundAmount,
        }).eq("id", addon.id);
      } else {
        await admin.from("order_items").update({
          is_refunded: true,
          refunded_at: new Date().toISOString(),
          refund_reference: reference,
          refund_amount: refundAmount,
        }).eq("id", item.id);
        // Auto-mark product unavailable (best-effort)
        if (item.product_id) {
          await admin.from("products").update({ is_available: false }).eq("id", item.product_id);
        }
      }
    } else if (action === "substitute") {
      const subFields = {
        substituted_with: body.substituteName || null,
        substitute_note: body.substituteNote || null,
        substituted_at: new Date().toISOString(),
      };
      if (scope === "addon") {
        await admin.from("order_item_addons").update(subFields).eq("id", addon.id);
      } else {
        const lineQty = Math.max(1, Number(item.quantity || 1));
        const subQty = Math.max(1, Math.min(lineQty, Math.floor(Number(body.substituteQuantity || lineQty))));

        if (subQty >= lineQty) {
          // Whole line substituted in place
          await admin.from("order_items").update({
            ...subFields,
            substitute_refund_amount: refundAmount || null,
          }).eq("id", item.id);
        } else {
          // Split the line: shrink original, insert a new substituted row for subQty
          const origUnit = Number(item.unit_price || 0);
          const origCalPerUnit = Number(item.calories || 0) / lineQty;
          const remainingQty = lineQty - subQty;

          // Subbed unit price = origUnit - (refund / subQty) ; if no refund, same unit price
          const subbedUnitPrice = Math.max(
            0,
            origUnit - (refundAmount > 0 ? refundAmount / subQty : 0),
          );
          const subbedTotal = +(subbedUnitPrice * subQty).toFixed(2);
          const remainingTotal = +(origUnit * remainingQty).toFixed(2);

          // 1) Shrink the original line (keep add-ons attached to it for the remaining portions)
          await admin.from("order_items").update({
            quantity: remainingQty,
            total_price: remainingTotal,
            calories: Math.round(origCalPerUnit * remainingQty),
            updated_at: new Date().toISOString?.() ?? undefined,
          }).eq("id", item.id);

          // 2) Insert a new substituted row for the subQty portions
          await admin.from("order_items").insert({
            order_id: item.order_id,
            product_id: item.product_id,
            product_name: item.product_name, // original name; substituted_with shows the swap
            quantity: subQty,
            unit_price: subbedUnitPrice,
            total_price: subbedTotal,
            calories: Math.round(origCalPerUnit * subQty),
            special_instructions: item.special_instructions,
            package_id: item.package_id,
            original_unit_price: item.original_unit_price ?? origUnit,
            purchase_unit: item.purchase_unit,
            unit_multiplier: item.unit_multiplier,
            ...subFields,
            substitute_refund_amount: refundAmount || null,
          });
        }
      }
    }

    // ---- Recalculate order totals from non-refunded items + non-refunded addons ----
    // item.total_price already bundles add-ons at insert time, so when an add-on
    // is refunded we subtract its (qty × price) from the item's effective total.
    const { data: allItems } = await admin
      .from("order_items").select("id, total_price, quantity, is_refunded").eq("order_id", order.id);
    const { data: allAddons } = await admin
      .from("order_item_addons").select("order_item_id, additional_price, is_refunded").eq("is_refunded", true);

    const refundedAddonByItem: Record<string, number> = {};
    for (const a of allAddons || []) {
      const parent = (allItems || []).find((i: any) => i.id === a.order_item_id);
      if (!parent || parent.is_refunded) continue; // parent already excluded
      const qty = Number(parent.quantity || 1);
      refundedAddonByItem[a.order_item_id] =
        (refundedAddonByItem[a.order_item_id] || 0) + Number(a.additional_price || 0) * qty;
    }

    const newSubtotal = (allItems || []).reduce((s: number, r: any) => {
      if (r.is_refunded) return s;
      const adj = refundedAddonByItem[r.id] || 0;
      return s + Math.max(0, Number(r.total_price || 0) - adj);
    }, 0);

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

    // ---- Post a chat message to the customer ----
    try {
      let msg = "";
      if (action === "refund") {
        msg = scope === "addon"
          ? `⚠️ The add-on "${displayName}" is unavailable. ₦${refundAmount.toLocaleString()} has been refunded to your wallet.`
          : `⚠️ "${displayName}" is unavailable. ₦${refundAmount.toLocaleString()} has been refunded to your wallet. The rest of your order is being prepared.`;
      } else {
        const sub = body.substituteName ? ` with "${body.substituteName}"` : "";
        const note = body.substituteNote ? ` — ${body.substituteNote}` : "";
        const refundLine = refundAmount > 0
          ? ` A partial refund of ₦${refundAmount.toLocaleString()} has been credited to your wallet.`
          : " (Same price, no charge difference.)";
        msg = `🔄 We've replaced "${displayName}"${sub}${note}.${refundLine} Reply here if this doesn't work for you.`;
      }
      await admin.from("order_chat_messages").insert({
        order_id: order.id,
        sender_id: user.id,
        sender_role: "vendor",
        message_type: "text",
        content: msg,
      });
    } catch (e) {
      console.warn("[vendor-refund-item] chat insert failed:", e);
    }

    console.log(`[vendor-refund-item] ${reference} order=${order.order_number} scope=${scope} action=${action} amount=₦${refundAmount}`);

    return json({
      success: true,
      reference,
      scope,
      action,
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
