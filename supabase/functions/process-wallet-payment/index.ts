import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { validateOrderPricing } from "../_shared/validate-order-pricing.ts";

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
    const body = await req.json();
    
    // Support both single orderId and multiple orderIds
    const orderIds: string[] = body.orderIds || (body.orderId ? [body.orderId] : []);

    if (orderIds.length === 0) {
      return new Response(
        JSON.stringify({ error: "Order ID(s) required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get user from auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Get user from token
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Invalid token" }),
        { status: 401, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get all order details
    const { data: orders, error: ordersError } = await supabaseAdmin
      .from("orders")
      .select("*, vendors(user_id, commission_rate)")
      .in("id", orderIds)
      .eq("user_id", user.id);

    if (ordersError || !orders || orders.length === 0) {
      return new Response(
        JSON.stringify({ error: "Orders not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Validate all orders are unpaid
    const alreadyPaid = orders.filter(o => o.payment_status === "paid");
    if (alreadyPaid.length > 0) {
      return new Response(
        JSON.stringify({ error: `Order(s) already paid: ${alreadyPaid.map(o => o.order_number).join(", ")}` }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // SERVER-AUTHORITATIVE PRICING GATE — recompute the delivery fee for every
    // order from trusted data before a single naira moves. A crafted client
    // that submitted its own delivery_fee/total is rejected here.
    for (const order of orders) {
      const check = await validateOrderPricing(supabaseAdmin, order);
      if (!check.ok) {
        console.error(
          `[wallet-payment] pricing validation failed for ${order.order_number}: stored=${check.storedFee} server=${check.serverFee}`,
        );
        return new Response(
          JSON.stringify({ error: check.message }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
    }

    // Get platform environment
    const { data: envSetting } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "platform_environment")
      .single();

    const environment = envSetting?.value || "development";

    // ONE transaction: lock the orders, verify the wallet, post the debit and
    // mark the orders paid — or nothing at all. Retrying returns the same
    // result without a second debit (deterministic WP-<order_id> reference).
    const batchRef = `WP-BATCH-${Date.now()}`;
    const { data: payResult, error: payError } = await supabaseAdmin.rpc("pay_orders_with_wallet", {
      p_order_ids: orders.map((o) => o.id),
      p_reference: batchRef,
      p_environment: environment,
    });

    if (payError) {
      const msg = payError.message || "";
      if (msg.includes("INSUFFICIENT_BALANCE")) {
        return new Response(
          JSON.stringify({ error: "Insufficient wallet balance" }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      if (msg.includes("WALLET_DISABLED")) {
        return new Response(
          JSON.stringify({ error: "Your wallet has been disabled. Please contact support." }),
          { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      console.error("[wallet-payment] atomic payment failed:", msg);
      return new Response(
        JSON.stringify({ error: "We couldn't complete the payment. Nothing was charged — please try again." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const result = (payResult ?? {}) as {
      paid?: Array<{ order_id: string; order_number: string; reference: string; amount: number }>;
      new_balance?: number;
    };
    const results = result.paid ?? [];

    for (const order of orders) {
      // Log promo usage if discount was applied
      if (Number(order.discount) > 0) {
        const menuSubtotal = Number(order.menu_subtotal) || (Number(order.subtotal) + Number(order.discount));
        const discountPercentage = (Number(order.discount) / menuSubtotal) * 100;

        await supabaseAdmin.from("promo_usage_log").insert({
          order_id: order.id,
          user_id: user.id,
          promo_type: order.promo_code?.startsWith("SPIN-") ? "spin" : "promo_code",
          promo_source: order.promo_code?.startsWith("SPIN-") ? "spin_wheel" : "manual",
          discount_percentage: discountPercentage,
          discount_amount: Number(order.discount),
          platform_cost: Number(order.discount),
          environment,
        });
      }

      // Trigger referral bonus processing (fire and forget)
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/process-referral-bonus`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({ orderId: order.id }),
        });
      } catch (refErr) {
        console.error('Referral bonus trigger failed (non-blocking):', refErr);
      }
    }

    const runningBalance = Number(result.new_balance ?? 0);
    const grandTotal = orders.reduce((sum, o) => sum + Number(o.total), 0);


    // NOTE: balances are already updated atomically by post_wallet_entry above.
    // Absolute-balance writes were removed to eliminate race conditions and drift.


    console.log(`Wallet payment processed: ${batchRef}, total: ₦${grandTotal}, orders: ${orders.length}, user: ${user.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        reference: batchRef,
        new_balance: runningBalance,
        orders: results,
        // Legacy compat for single-order callers
        order_number: results[0]?.orderNumber,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error processing wallet payment:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
