import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization");
    console.log("Auth header present:", !!authHeader);
    if (!authHeader) throw new Error("Unauthorized - no auth header");
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    console.log("User resolved:", !!user, "Auth error:", authErr?.message);
    if (authErr || !user) throw new Error("Unauthorized - invalid token");

    const { data: roles } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    console.log("User roles:", JSON.stringify(roles));
    if (!roles?.some((r: any) => r.role === "admin")) throw new Error("Admin access required");

    const { orderId, newDeliveryType } = await req.json();
    if (!orderId || !["delivery", "self_pickup"].includes(newDeliveryType)) {
      throw new Error("Invalid parameters");
    }

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();
    if (orderErr || !order) throw new Error("Order not found");

    if (order.status === "delivered" || order.status === "cancelled") {
      throw new Error("Cannot change delivery type on completed/cancelled orders");
    }

    const currentType = order.delivery_type || "delivery";
    if (currentType === newDeliveryType) {
      return new Response(JSON.stringify({ success: true, message: "No change needed" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const isTest = order.environment === "development";
    const originalDeliveryFee = Number(order.delivery_fee) || 0;

    if (newDeliveryType === "self_pickup") {
      if (originalDeliveryFee > 0 && order.payment_status === "paid") {
        const { data: customerWallet } = await supabase
          .from("wallets")
          .select("id")
          .eq("user_id", order.user_id)
          .eq("wallet_type", "customer")
          .maybeSingle();

        if (customerWallet) {
          await supabase.rpc("admin_adjust_wallet_balance", {
            p_wallet_id: customerWallet.id,
            p_amount: originalDeliveryFee,
            p_adjust_type: "credit",
            p_notes: `Delivery fee refund - order #${order.order_number} switched to self-pickup by admin`,
            p_environment: isTest ? "development" : "production",
          });
        }
      }

      const newTotal = Number(order.total) - originalDeliveryFee;
      const { error: updateErr } = await supabase
        .from("orders")
        .update({
          delivery_type: "self_pickup",
          delivery_fee: 0,
          total: newTotal,
          delivery_address_text: "Self-pickup at vendor",
          rider_id: null,
        })
        .eq("id", orderId);

      if (updateErr) throw updateErr;

      return new Response(
        JSON.stringify({
          success: true,
          message: `Switched to self-pickup. ₦${originalDeliveryFee.toLocaleString()} delivery fee refunded to customer wallet.`,
          refundedAmount: originalDeliveryFee,
          newTotal,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      const { data: settings } = await supabase
        .from("platform_settings")
        .select("key, value")
        .in("key", ["base_delivery_fee", "base_delivery_distance_km", "per_km_fee"]);

      const settingsMap: Record<string, string> = {};
      settings?.forEach((s: any) => { settingsMap[s.key] = s.value; });

      const baseDeliveryFee = parseFloat(settingsMap["base_delivery_fee"]) || 500;

      const { data: customerWallet } = await supabase
        .from("wallets")
        .select("id, balance, test_balance")
        .eq("user_id", order.user_id)
        .eq("wallet_type", "customer")
        .maybeSingle();

      const walletBalance = isTest
        ? Number(customerWallet?.test_balance || 0)
        : Number(customerWallet?.balance || 0);

      if (order.payment_status === "paid" && walletBalance < baseDeliveryFee) {
        return new Response(
          JSON.stringify({
            success: false,
            message: `Insufficient customer wallet balance. Needs ₦${baseDeliveryFee.toLocaleString()} for delivery fee but only has ₦${walletBalance.toLocaleString()}.`,
            requiredAmount: baseDeliveryFee,
            currentBalance: walletBalance,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (order.payment_status === "paid" && customerWallet) {
        await supabase.rpc("admin_adjust_wallet_balance", {
          p_wallet_id: customerWallet.id,
          p_amount: baseDeliveryFee,
          p_adjust_type: "debit",
          p_notes: `Delivery fee charge - order #${order.order_number} switched to delivery by admin`,
          p_environment: isTest ? "development" : "production",
        });
      }

      const newTotal = Number(order.total) + baseDeliveryFee;
      const { error: updateErr } = await supabase
        .from("orders")
        .update({
          delivery_type: "delivery",
          delivery_fee: baseDeliveryFee,
          total: newTotal,
        })
        .eq("id", orderId);

      if (updateErr) throw updateErr;

      return new Response(
        JSON.stringify({
          success: true,
          message: `Switched to delivery. ₦${baseDeliveryFee.toLocaleString()} delivery fee charged from customer wallet.`,
          chargedAmount: baseDeliveryFee,
          newTotal,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (err: any) {
    console.error("switch-delivery-type error:", err);
    return new Response(
      JSON.stringify({ success: false, message: err.message }),
      { status: err.message?.includes("Unauthorized") ? 401 : 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
