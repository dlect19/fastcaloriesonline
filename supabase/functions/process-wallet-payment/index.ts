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
    const { orderId } = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: "Order ID is required" }),
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

    // Get order details
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("*, vendors(user_id, commission_rate)")
      .eq("id", orderId)
      .eq("user_id", user.id)
      .single();

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (order.payment_status === "paid") {
      return new Response(
        JSON.stringify({ error: "Order is already paid" }),
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

    // Check balance
    const currentBalance = isTestMode 
      ? Number(customerWallet.test_balance) || 0
      : Number(customerWallet.balance) || 0;

    const orderTotal = Number(order.total);

    if (currentBalance < orderTotal) {
      return new Response(
        JSON.stringify({ 
          error: "Insufficient wallet balance",
          balance: currentBalance,
          required: orderTotal,
        }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Generate unique reference
    const reference = `WP-${orderId.slice(0, 8)}-${Date.now()}`;

    // Debit customer wallet
    const newBalance = currentBalance - orderTotal;

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

    // Log customer debit transaction
    await supabaseAdmin.from("wallet_transactions").insert({
      wallet_id: customerWallet.id,
      wallet_type: "customer",
      transaction_type: "debit",
      category: "wallet_payment",
      amount: orderTotal,
      balance_after: newBalance,
      reference,
      order_id: orderId,
      status: "completed",
      environment,
      notes: `Payment for order #${order.order_number}`,
    });

    // Update order payment status
    await supabaseAdmin
      .from("orders")
      .update({
        payment_status: "paid",
        payment_method: "wallet",
        payment_reference: reference,
        environment,
      })
      .eq("id", orderId);

    // The database triggers (credit_vendor_on_payment, credit_rider_on_assignment) 
    // will handle vendor/rider/platform splits automatically

    console.log(`Wallet payment processed: ${reference}, amount: ₦${orderTotal}, user: ${user.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        reference,
        new_balance: newBalance,
        order_number: order.order_number,
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
