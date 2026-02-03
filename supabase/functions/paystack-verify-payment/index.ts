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

    // Note: Calories are now logged on delivery confirmation, not payment

    console.log(`Order ${orderNumber} payment confirmed`);

    // Log promo usage if discount was applied (Platform Absorbs Loss accounting)
    if (orderData.discount && Number(orderData.discount) > 0) {
      const menuSubtotal = Number(orderData.menu_subtotal) || (Number(orderData.subtotal) + Number(orderData.discount));
      const discountPercentage = (Number(orderData.discount) / menuSubtotal) * 100;
      
      await supabaseClient.from("promo_usage_log").insert({
        order_id: orderId,
        user_id: orderData.user_id,
        promo_type: orderData.promo_code?.startsWith("SPIN-") ? "spin" 
          : orderData.promo_code ? "promo_code" 
          : "platform_promo",
        promo_source: orderData.promo_code?.startsWith("SPIN-") ? "spin_wheel" : "manual",
        discount_percentage: discountPercentage,
        discount_amount: Number(orderData.discount),
        platform_cost: Number(orderData.discount),
        environment: orderData.environment || "production",
      });
      console.log(`Logged promo usage: ${discountPercentage.toFixed(1)}% = ₦${orderData.discount}`);
    }

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
