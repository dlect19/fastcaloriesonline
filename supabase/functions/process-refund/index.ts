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

    // Check if user is admin OR vendor/staff who owns the order's vendor
    const { data: adminRole } = await supabaseAdmin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .single();

    let isAuthorized = !!adminRole;

    if (!isAuthorized) {
      // Check if user is vendor owner or active staff for the order's vendor
      const { data: orderCheck } = await supabaseAdmin
        .from("orders")
        .select("vendor_id")
        .eq("id", orderId)
        .single();

      if (orderCheck?.vendor_id) {
        // Check vendor owner
        const { data: vendor } = await supabaseAdmin
          .from("vendors")
          .select("id")
          .eq("id", orderCheck.vendor_id)
          .eq("user_id", user.id)
          .single();

        if (vendor) {
          isAuthorized = true;
        } else {
          // Check vendor staff
          const { data: staff } = await supabaseAdmin
            .from("vendor_staff")
            .select("id")
            .eq("vendor_id", orderCheck.vendor_id)
            .eq("user_id", user.id)
            .eq("is_active", true)
            .single();

          if (staff) isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      return new Response(
        JSON.stringify({ error: "Unauthorized: admin or vendor access required" }),
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
      // Idempotent: treat as success so callers (e.g. cancel flow) don't error on retry
      return new Response(
        JSON.stringify({ success: true, already_processed: true, message: "Refund already processed for this order" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!order.user_id) {
      // Assisted order without a registered customer — route to shadow credit by phone
      const amt = customAmount ? Number(customAmount) : Number(order.total);
      const { data: assisted } = await supabaseAdmin
        .from("assisted_orders")
        .select("receiver_phone, receiver_name, environment")
        .eq("order_id", orderId)
        .maybeSingle();

      const phone = String(assisted?.receiver_phone || order.delivery_phone || "").trim();
      if (!phone) {
        // No phone on file — record as offline refund (audit only) and mark order refunded
        await supabaseAdmin.from("assisted_order_audit").insert({
          order_id: orderId,
          actor_id: user.id,
          action: "refund_offline_auto",
          details: { amount: amt, reason: reason || "Order refund", note: "No phone on file; recorded as offline refund" },
        });
        await supabaseAdmin.from("orders").update({ payment_status: "refunded" }).eq("id", orderId);
        return new Response(
          JSON.stringify({
            success: true,
            offline: true,
            message: `₦${amt.toLocaleString()} recorded as offline refund (no phone on file to hold shadow credit).`,
          }),
          { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      const { data: shadowRow, error: shadowErr } = await supabaseAdmin
        .from("shadow_customer_credits")
        .insert({
          phone,
          customer_name: assisted?.receiver_name || null,
          amount: amt,
          environment: assisted?.environment || "development",
          status: "pending",
          source: "order_refund",
          order_id: orderId,
          reason: reason || "Order refund",
          created_by: user.id,
        })
        .select("id")
        .maybeSingle();

      if (shadowErr) {
        return new Response(
          JSON.stringify({ error: `Failed to record shadow credit: ${shadowErr.message}` }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
        );
      }

      // Mark order refunded for accounting consistency
      await supabaseAdmin
        .from("orders")
        .update({ payment_status: "refunded" })
        .eq("id", orderId);

      return new Response(
        JSON.stringify({
          success: true,
          shadow: true,
          shadow_id: shadowRow?.id,
          message: `₦${amt.toLocaleString()} held as shadow credit for ${phone}. It will auto-credit their wallet when they sign up.`,
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
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
