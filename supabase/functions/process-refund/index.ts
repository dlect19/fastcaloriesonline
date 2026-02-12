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
    const { orderId, reason, amount: customAmount } = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: "Order ID is required" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get user from auth header (must be admin)
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

    // Check if user is admin
    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    if (!adminRole) {
      return new Response(
        JSON.stringify({ error: "Admin access required" }),
        { status: 403, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get order details
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // CRITICAL: Only refund orders that were actually paid
    if (order.payment_status !== 'paid') {
      console.log(`Refund skipped: order ${order.order_number} has payment_status=${order.payment_status}`);
      return new Response(
        JSON.stringify({ error: "Order was not paid — no refund needed", skipped: true }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if refund already processed
    const { data: existingRefund } = await supabaseAdmin
      .from("wallet_transactions")
      .select("id")
      .eq("order_id", orderId)
      .eq("category", "refund")
      .single();

    if (existingRefund) {
      return new Response(
        JSON.stringify({ error: "Refund already processed for this order" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!order.user_id) {
      return new Response(
        JSON.stringify({ error: "Order has no associated customer" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
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

    // Determine refund amount (use custom amount or full order total)
    const refundAmount = customAmount ? Number(customAmount) : Number(order.total);

    if (refundAmount <= 0 || refundAmount > Number(order.total)) {
      return new Response(
        JSON.stringify({ error: "Invalid refund amount" }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get or create customer wallet
    let { data: customerWallet } = await supabaseAdmin
      .from("wallets")
      .select("*")
      .eq("user_id", order.user_id)
      .eq("wallet_type", "customer")
      .single();

    if (!customerWallet) {
      // Create wallet if it doesn't exist
      const { data: newWallet, error: createError } = await supabaseAdmin
        .from("wallets")
        .insert({
          user_id: order.user_id,
          wallet_type: "customer",
        })
        .select()
        .single();

      if (createError) {
        console.error("Error creating wallet:", createError);
        return new Response(
          JSON.stringify({ error: "Failed to create customer wallet" }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }
      customerWallet = newWallet;
    }

    // Generate unique reference
    const reference = `RF-${orderId.slice(0, 8)}-${Date.now()}`;

    // Credit customer wallet
    const currentBalance = isTestMode 
      ? Number(customerWallet.test_balance) || 0
      : Number(customerWallet.balance) || 0;

    const newBalance = currentBalance + refundAmount;

    if (isTestMode) {
      await supabaseAdmin
        .from("wallets")
        .update({ test_balance: newBalance, updated_at: new Date().toISOString() })
        .eq("id", customerWallet.id);
    } else {
      await supabaseAdmin
        .from("wallets")
        .update({ balance: newBalance, updated_at: new Date().toISOString() })
        .eq("id", customerWallet.id);
    }

    // Log refund transaction
    await supabaseAdmin.from("wallet_transactions").insert({
      wallet_id: customerWallet.id,
      wallet_type: "customer",
      transaction_type: "credit",
      category: "refund",
      amount: refundAmount,
      balance_after: newBalance,
      reference,
      order_id: orderId,
      status: "completed",
      environment,
      notes: reason || `Refund for order #${order.order_number}`,
      metadata: {
        refunded_by: user.id,
        original_total: order.total,
        refund_reason: reason,
      },
    });

    console.log(`Refund processed: ${reference}, amount: ₦${refundAmount}, order: ${order.order_number}`);

    return new Response(
      JSON.stringify({
        success: true,
        reference,
        refund_amount: refundAmount,
        new_balance: newBalance,
        order_number: order.order_number,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error processing refund:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
