import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const paystackSecretKey = Deno.env.get('PAYSTACK_SECRET_KEY')!;

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    const { reference } = await req.json();

    if (!reference) {
      return new Response(
        JSON.stringify({ success: false, message: 'Reference is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Verifying payment reference: ${reference}`);

    // Verify with Paystack
    const paystackResponse = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
      headers: {
        'Authorization': `Bearer ${paystackSecretKey}`,
      },
    });

    const paystackData = await paystackResponse.json();

    if (!paystackData.status || paystackData.data.status !== 'success') {
      console.log('Payment not successful:', paystackData);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: paystackData.data?.gateway_response || 'Payment not successful' 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const orderId = paystackData.data.metadata?.order_id;
    const orderNumber = paystackData.data.metadata?.order_number;

    if (!orderId) {
      console.error('No order ID in payment metadata');
      return new Response(
        JSON.stringify({ success: false, message: 'Order not found in payment data' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get order details including items for calorie logging
    const { data: orderData, error: orderFetchError } = await supabaseClient
      .from('orders')
      .select(`
        *,
        order_items (
          id,
          product_name,
          calories,
          quantity
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderFetchError) {
      console.error('Order fetch error:', orderFetchError);
      return new Response(
        JSON.stringify({ success: false, message: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update order payment status
    const { error: updateError } = await supabaseClient
      .from('orders')
      .update({ 
        payment_status: 'paid',
        status: 'confirmed',
        payment_reference: reference
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('Order update error:', updateError);
      return new Response(
        JSON.stringify({ success: false, message: 'Failed to update order' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Log calories for the user if order has calorie data
    if (orderData.user_id && orderData.total_calories && orderData.total_calories > 0) {
      try {
        // Calculate total macros from order items
        let totalCarbs = 0;
        let totalProtein = 0;
        let totalFats = 0;

        // Get product details for macro info
        const productIds = (orderData.order_items || [])
          .filter((item: any) => item.product_id)
          .map((item: any) => item.product_id);

        if (productIds.length > 0) {
          const { data: products } = await supabaseClient
            .from('products')
            .select('id, carbs_grams, protein_grams, fats_grams')
            .in('id', productIds);

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

        const { error: calorieLogError } = await supabaseClient
          .from('calorie_logs')
          .insert({
            user_id: orderData.user_id,
            order_id: orderId,
            calories: orderData.total_calories,
            carbs_grams: totalCarbs,
            protein_grams: totalProtein,
            fats_grams: totalFats,
            meal_type: 'order',
            log_date: new Date().toISOString().split('T')[0],
          });

        if (calorieLogError) {
          console.error('Calorie log error:', calorieLogError);
        } else {
          console.log(`Logged ${orderData.total_calories} calories for user ${orderData.user_id}`);
        }
      } catch (calorieErr) {
        console.error('Error logging calories:', calorieErr);
        // Don't fail the payment for calorie logging errors
      }
    }

    console.log(`Order ${orderNumber} payment confirmed`);

    // Send payment receipt email (fire and forget)
    try {
      await fetch(`${supabaseUrl}/functions/v1/send-payment-receipt`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${supabaseServiceKey}`,
        },
        body: JSON.stringify({ orderId }),
      });
      console.log('Payment receipt email triggered');
    } catch (emailErr) {
      console.error('Failed to trigger receipt email:', emailErr);
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        orderNumber,
        message: 'Payment verified successfully' 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Payment verification error:', error);
    return new Response(
      JSON.stringify({ success: false, message: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
