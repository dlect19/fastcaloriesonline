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
    const isAdmin = roles?.some((r: any) => r.role === "admin");
    console.log("User roles:", JSON.stringify(roles), "isAdmin:", isAdmin);

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

    // Allow admin OR order owner (customer)
    const isOrderOwner = order.user_id === user.id;
    if (!isAdmin && !isOrderOwner) throw new Error("Access denied - not admin or order owner");

    // Customer can only switch if no rider assigned (delivery→pickup)
    if (!isAdmin && isOrderOwner && order.rider_id && order.delivery_type !== "self_pickup") {
      throw new Error("Cannot switch - a rider is already assigned to this order");
    }

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
          .select("id, balance, test_balance")
          .eq("user_id", order.user_id)
          .eq("wallet_type", "customer")
          .maybeSingle();

        if (customerWallet) {
          const { error: walletErr } = await supabase.rpc("post_wallet_entry", {
            p_wallet_id: customerWallet.id,
            p_wallet_type: "customer",
            p_transaction_type: "credit",
            p_category: "admin_credit",
            p_amount: originalDeliveryFee,
            p_reference: `SDT-REFUND-${orderId}`,
            p_environment: isTest ? "development" : "production",
            p_order_id: orderId,
            p_notes: `Delivery fee refund - order #${order.order_number} switched to carryout by admin`,
            p_metadata: { source: "switch-delivery-type", direction: "to_carryout" },
          });

          if (walletErr) {
            console.error("Wallet credit error:", walletErr);
            throw new Error("Failed to refund delivery fee to customer wallet");
          }

          console.log(`Refunded ₦${originalDeliveryFee} to customer wallet ${customerWallet.id}`);
        }

      }

      const newTotal = Number(order.total) - originalDeliveryFee;
      const { error: updateErr } = await supabase
        .from("orders")
        .update({
          delivery_type: "self_pickup",
          delivery_fee: 0,
          total: newTotal,
          delivery_address_text: "Carryout at vendor",
          rider_id: null,
        })
        .eq("id", orderId);

      if (updateErr) throw updateErr;

      return new Response(
        JSON.stringify({
          success: true,
          message: `Switched to carryout. ₦${originalDeliveryFee.toLocaleString()} delivery fee refunded to customer wallet.`,
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
        const { error: walletErr } = await supabase.rpc("post_wallet_entry", {
          p_wallet_id: customerWallet.id,
          p_wallet_type: "customer",
          p_transaction_type: "debit",
          p_category: "admin_debit",
          p_amount: baseDeliveryFee,
          p_reference: `SDT-CHARGE-${orderId}`,
          p_environment: isTest ? "development" : "production",
          p_order_id: orderId,
          p_notes: `Delivery fee charge - order #${order.order_number} switched to delivery by admin`,
          p_metadata: { source: "switch-delivery-type", direction: "to_delivery" },
        });

        if (walletErr) {
          console.error("Wallet debit error:", walletErr);
          throw new Error("Failed to charge delivery fee from customer wallet");
        }

        console.log(`Charged ₦${baseDeliveryFee} from customer wallet ${customerWallet.id}`);
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
