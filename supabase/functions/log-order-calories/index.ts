import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Get order with items
    const { data: orderData, error: orderError } = await supabaseAdmin
      .from("orders")
      .select(`
        id,
        user_id,
        total_calories,
        order_items (
          id,
          product_id,
          quantity
        )
      `)
      .eq("id", orderId)
      .single();

    if (orderError || !orderData) {
      console.error("Order not found:", orderError);
      return new Response(
        JSON.stringify({ error: "Order not found" }),
        { status: 404, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Check if calories already logged for this order
    const { data: existingLog } = await supabaseAdmin
      .from("calorie_logs")
      .select("id")
      .eq("order_id", orderId)
      .maybeSingle();

    if (existingLog) {
      console.log(`Calories already logged for order ${orderId}`);
      return new Response(
        JSON.stringify({ success: true, message: "Already logged" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Only log if order has calories and user
    if (!orderData.user_id || !orderData.total_calories || orderData.total_calories <= 0) {
      console.log(`No calories to log for order ${orderId}`);
      return new Response(
        JSON.stringify({ success: true, message: "No calories to log" }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Calculate macros from order items
    let totalCarbs = 0;
    let totalProtein = 0;
    let totalFats = 0;

    const productIds = (orderData.order_items || [])
      .filter((item: any) => item.product_id)
      .map((item: any) => item.product_id);

    if (productIds.length > 0) {
      const { data: products } = await supabaseAdmin
        .from("products")
        .select("id, carbs_grams, protein_grams, fats_grams")
        .in("id", productIds);

      if (products) {
        for (const item of orderData.order_items || []) {
          const product = products.find((p: any) => p.id === item.product_id);
          if (product) {
            totalCarbs += (product.carbs_grams || 0) * (item.quantity || 1);
            totalProtein += (product.protein_grams || 0) * (item.quantity || 1);
            totalFats += (product.fats_grams || 0) * (item.quantity || 1);
          }
        }
      }
    }

    // Determine meal type based on current hour
    const currentHour = new Date().getHours();
    let mealType = "lunch"; // default
    if (currentHour >= 5 && currentHour < 11) {
      mealType = "breakfast";
    } else if (currentHour >= 11 && currentHour < 16) {
      mealType = "lunch";
    } else if (currentHour >= 16 && currentHour < 21) {
      mealType = "dinner";
    } else {
      mealType = "snack";
    }

    // Insert calorie log
    const { error: logError } = await supabaseAdmin
      .from("calorie_logs")
      .insert({
        user_id: orderData.user_id,
        order_id: orderId,
        calories: orderData.total_calories,
        carbs_grams: totalCarbs,
        protein_grams: totalProtein,
        fats_grams: totalFats,
        meal_type: mealType,
        log_date: new Date().toISOString().split("T")[0],
      });

    if (logError) {
      console.error("Failed to log calories:", logError);
      return new Response(
        JSON.stringify({ error: "Failed to log calories" }),
        { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    console.log(`Logged ${orderData.total_calories} calories for order ${orderId}, user ${orderData.user_id}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        calories: orderData.total_calories,
        carbs: totalCarbs,
        protein: totalProtein,
        fats: totalFats
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    console.error("Error logging calories:", errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});
