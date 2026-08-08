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

    // ---- Detect assisted order — refunds go to shadow_customer_credits ----
    const { data: assisted } = await admin
      .from("assisted_orders").select("id, payment_status").eq("order_id", order.id).maybeSingle();
    const isAssisted = !!assisted;

    // ---- Credit destination ----
    let refundedToWallet = false;
    let refundedToShadow = false;
    let shadowCreditId: string | null = null;
    let newBalance: number | null = null;
    const reference = `${scope === "addon" ? "RA" : "RI"}-${(addon?.id || item.id).slice(0, 8)}-${Date.now()}`;

    const orderPaid = order.payment_status === "paid" || (isAssisted && assisted?.payment_status === "received");

    if (refundAmount > 0 && orderPaid && isAssisted) {
      // Route to shadow credit (auto-claimed when customer signs up with same phone)
      const phone = String((order as any).receiver_phone || "").trim();
      if (phone) {
        const { data: shadow, error: shadowErr } = await admin.from("shadow_customer_credits").insert({
          phone,
          customer_name: (order as any).receiver_name || null,
          amount: refundAmount,
          environment,
          status: "pending",
          source: "assisted_refund",
          order_id: order.id,
          reason: action === "substitute" ? "Substitute partial refund" : `${scope === "addon" ? "Add-on" : "Item"} refund`,
          notes: body.reason || `${displayName} (#${order.order_number})${body.substituteName ? ` → ${body.substituteName}` : ""}`,
          created_by: user.id,
        }).select("id").maybeSingle();
        if (!shadowErr && shadow) {
          shadowCreditId = shadow.id;
          refundedToShadow = true;
          if (order.user_id) {
            // Nudge auto-claim trigger if customer already has a profile
            await admin.from("profiles").update({ updated_at: new Date().toISOString() }).eq("user_id", order.user_id);
          }
        } else if (shadowErr) {
          console.error("[vendor-refund-item] shadow insert failed:", shadowErr.message);
        }
      } else {
        console.warn("[vendor-refund-item] assisted order missing receiver_phone — refund not credited");
      }
    } else if (refundAmount > 0 && orderPaid && order.user_id) {
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
        const { error: postErr } = await admin.rpc("post_wallet_entry", {
          p_wallet_id: wallet.id,
          p_wallet_type: "customer",
          p_transaction_type: "credit",
          p_category: "refund",
          p_amount: refundAmount,
          p_reference: reference,
          p_environment: environment,
          p_order_id: order.id,
          p_notes: body.reason ||
            (action === "substitute"
              ? `Substitute partial refund: ${displayName} (#${order.order_number})`
              : `${scope === "addon" ? "Add-on" : "Item"} refund: ${displayName} (#${order.order_number})`),
          p_metadata: {
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
        if (postErr) {
          console.error("[vendor-refund-item] post_wallet_entry failed:", postErr.message);
          return new Response(JSON.stringify({ error: "Refund could not be credited: " + postErr.message }), {
            status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
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

      const lineQty = Math.max(1, Number(item.quantity || 1));
      // Full-line replace for BOTH item and addon: subQty is the REPLACEMENT
      // quantity used to derive the refund on the client. We don't cap it.
      const rawSubQty = Math.max(1, Math.floor(Number(body.substituteQuantity || lineQty)));
      const subQty = rawSubQty;
      const origUnit = Number(item.unit_price || 0);
      const origCalPerUnit = Number(item.calories || 0) / lineQty;

      // Fetch all add-ons attached to the parent item (needed for split math + addon scope).
      // IMPORTANT: include refunded add-ons in addonSumPerPortion so the line's total_price
      // mirrors the original pre-refund composition. The order-level subtotal recompute
      // below is the *only* place refunded add-ons get subtracted — otherwise we'd deduct
      // them twice and the vendor revenue would come up short.
      const { data: parentAddons } = await admin
        .from("order_item_addons")
        .select("*")
        .eq("order_item_id", item.id);
      const allAddons = parentAddons || [];
      const addonSumPerPortion = allAddons.reduce((s: number, a: any) => s + Number(a.additional_price || 0), 0);

      if (scope === "addon") {
        // Full-line replace (mirrors item logic): the addon on every parent
        // portion is swapped to the new one. Refund is whatever the caller
        // computed — typically (lineQty × origAddonPrice) − (subQty × newAddonPrice).
        // We translate that refund into a new per-portion additional_price so
        // the parent's total_price decreases by exactly refundAmount.
        const origAddonUnit = Number(addon.additional_price || 0);
        const newAddonUnit = Math.max(
          0,
          +(origAddonUnit - (refundAmount > 0 ? refundAmount / lineQty : 0)).toFixed(2),
        );
        await admin.from("order_item_addons").update({
          ...subFields,
          addon_item_name: body.substituteName || addon.addon_item_name,
          additional_price: newAddonUnit,
        }).eq("id", addon.id);

        // Recompute parent total with the new addon price. Include refunded
        // add-ons too (see addonSumPerPortion note above) so we don't double-subtract.
        const newAddonSum = allAddons.reduce(
          (s: number, a: any) => s + (a.id === addon.id ? newAddonUnit : Number(a.additional_price || 0)),
          0,
        );
        await admin.from("order_items").update({
          total_price: +((origUnit + newAddonSum) * lineQty).toFixed(2),
        }).eq("id", item.id);
      } else {
        // scope === "item" — full-line replace.
        // Vendor specifies the REPLACEMENT quantity (subQty), not how many of the
        // original to swap. The whole original line becomes subQty × substitute.
        // Refund = (lineQty × origUnit) − (subQty × subbedUnitPrice).
        // We derive the substitute unit price from refundAmount so the math is consistent:
        //   subbedUnitPrice = (lineQty × origUnit − refundAmount) / subQty
        const origLineTotal = lineQty * origUnit;
        const newLineTotal = Math.max(0, origLineTotal - refundAmount);
        const subbedUnitPrice = subQty > 0 ? +(newLineTotal / subQty).toFixed(2) : 0;
        // Keep existing add-ons but recompute parent total to reflect new qty + new unit price.
        const newTotalWithAddons = +(((subbedUnitPrice + addonSumPerPortion) * subQty)).toFixed(2);

        await admin.from("order_items").update({
          quantity: subQty,
          unit_price: subbedUnitPrice,
          total_price: newTotalWithAddons,
          calories: Math.round(origCalPerUnit * subQty),
          // Rename the line so receipts/chat/customer view show the actual item served.
          // Original name is preserved on substituted_with for audit.
          product_name: body.substituteName || item.product_name,
          ...subFields,
          substitute_refund_amount: refundAmount || null,
        }).eq("id", item.id);
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

    // Re-sync vendor payout + platform commission to the new menu_subtotal.
    // Without this the pending vendor_share keeps the pre-refund amount and the
    // platform absorbs the loss when the hold releases. This MUST succeed —
    // we surface any failure to the caller so the vendor knows the books are
    // out of sync and an admin can re-run it from the Ledger Audit page.
    {
      const { data: adj, error: adjErr } = await admin.rpc("adjust_vendor_payout_after_refund", {
        p_order_id: order.id,
      });
      if (adjErr) {
        console.error("[vendor-refund-item] payout adjust failed:", adjErr.message);
        return json({
          error: `Refund recorded but vendor payout could not be adjusted: ${adjErr.message}. Please contact support so the ledger can be reconciled.`,
        }, 500);
      }
      console.log("[vendor-refund-item] payout adjust:", adj);
    }


    // ---- Post a chat message to the customer ----
    // For assisted orders we credit a shadow credit (held by phone) instead of a wallet.
    const creditDestLabel = refundedToShadow
      ? "held as credit on your phone number (it will auto-credit your wallet when you sign up)"
      : "refunded to your wallet";
    const creditDestLabelShort = refundedToShadow ? "held as credit on your phone number" : "credited to your wallet";

    try {
      let msg = "";
      if (action === "refund") {
        msg = scope === "addon"
          ? `⚠️ The add-on "${displayName}" is unavailable. ₦${refundAmount.toLocaleString()} has been ${creditDestLabel}.`
          : `⚠️ "${displayName}" is unavailable. ₦${refundAmount.toLocaleString()} has been ${creditDestLabel}. The rest of your order is being prepared.`;
      } else {
        const sub = body.substituteName ? ` with "${body.substituteName}"` : "";
        const note = body.substituteNote ? ` — ${body.substituteNote}` : "";
        const refundLine = refundAmount > 0
          ? ` A partial refund of ₦${refundAmount.toLocaleString()} has been ${creditDestLabelShort}.`
          : " (Same price, no charge difference.)";
        const lineQty = Math.max(1, Number(item.quantity || 1));
        const rawQ = Math.max(1, Math.floor(Number(body.substituteQuantity || lineQty)));
        const subQty = scope === "addon" ? Math.min(lineQty, rawQ) : rawQ;
        let portionPrefix = "";
        if (scope === "addon") {
          portionPrefix = `the add-on on your ${lineQty} × `;
        } else {
          portionPrefix = `your ${lineQty} × `;
        }
        const itemSuffix = body.substituteName
          ? ` with ${subQty} × "${body.substituteName}"${note}`
          : `${sub}${note}`;
        msg = `🔄 We've replaced ${portionPrefix}"${displayName}"${itemSuffix}.${refundLine} Reply here if this doesn't work for you.`;
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

    console.log(`[vendor-refund-item] ${reference} order=${order.order_number} scope=${scope} action=${action} amount=₦${refundAmount} dest=${refundedToShadow ? "shadow" : refundedToWallet ? "wallet" : "none"}`);

    return json({
      success: true,
      reference,
      scope,
      action,
      refund_amount: refundAmount,
      refunded_to_wallet: refundedToWallet,
      refunded_to_shadow: refundedToShadow,
      shadow_credit_id: shadowCreditId,
      assisted_order: isAssisted,
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
