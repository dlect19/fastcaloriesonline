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

    // Get customer wallet
    const { data: customerWallet, error: walletError } = await supabaseAdmin
      .from("wallets")
      .select("*")
      .eq("user_id", user.id)
      .eq("wallet_type", "customer")
      .single();

    if (walletError || !customerWallet) {
      return new Response(
        JSON.stringify({ error: "Wallet not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (customerWallet.is_disabled) {
      return new Response(
        JSON.stringify({ error: "Your wallet has been disabled. Please contact support." }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get platform environment
    const { data: envSetting } = await supabaseAdmin
      .from("platform_settings")
      .select("value")
      .eq("key", "platform_environment")
      .single();

    const environment = envSetting?.value || "development";
    const isTestMode = environment === "development";

    const currentBalance = isTestMode 
      ? Number(customerWallet.test_balance) || 0
      : Number(customerWallet.balance) || 0;

    // Calculate grand total across all orders
    const grandTotal = orders.reduce((sum, o) => sum + Number(o.total), 0);

    if (currentBalance < grandTotal) {
      return new Response(
        JSON.stringify({ 
          error: "Insufficient wallet balance",
          balance: currentBalance,
          required: grandTotal,
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Generate batch reference
    const batchRef = `WP-BATCH-${Date.now()}`;
    let runningBalance = currentBalance;
    const results: Array<{ orderId: string; orderNumber: string; reference: string; amount: number }> = [];

    // Process each order
    for (const order of orders) {
      const orderTotal = Number(order.total);
      const reference = orders.length === 1
        ? `WP-${order.id.slice(0, 8)}-${Date.now()}`
        : `${batchRef}-${order.id.slice(0, 8)}`;

      // SAFETY: Update order FIRST — if this fails, wallet is untouched
      const { error: orderUpdateError } = await supabaseAdmin
        .from("orders")
        .update({
          payment_status: "paid",
          status: "confirmed",
          payment_method: "wallet",
          payment_reference: reference,
          environment,
        })
        .eq("id", order.id);

      if (orderUpdateError) {
        console.error(`Order update failed for ${order.order_number}:`, orderUpdateError.message);
        // Skip this order entirely — do NOT debit the wallet
        continue;
      }

      runningBalance -= orderTotal;

      // Log wallet debit transaction AFTER successful order update
      await supabaseAdmin.from("wallet_transactions").insert({
        wallet_id: customerWallet.id,
        wallet_type: "customer",
        transaction_type: "debit",
        category: "wallet_payment",
        amount: orderTotal,
        balance_after: runningBalance,
        reference,
        order_id: order.id,
        status: "completed",
        environment,
        notes: `Payment for order #${order.order_number}${orders.length > 1 ? ` (batch: ${batchRef})` : ''}`,
      });

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

      results.push({ orderId: order.id, orderNumber: order.order_number, reference, amount: orderTotal });
    }

    // If no orders were successfully processed, return error
    if (results.length === 0) {
      return new Response(
        JSON.stringify({ error: "All order updates failed — wallet was NOT debited. Please try again." }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Debit the full amount from wallet in one update (only for successfully processed orders)
    if (isTestMode) {
      await supabaseAdmin
        .from("wallets")
        .update({ test_balance: runningBalance, updated_at: new Date().toISOString() })
        .eq("id", customerWallet.id);
    } else {
      await supabaseAdmin
        .from("wallets")
        .update({ balance: runningBalance, updated_at: new Date().toISOString() })
        .eq("id", customerWallet.id);
    }

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
