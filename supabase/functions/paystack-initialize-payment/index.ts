import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

// Helper function to get the correct Paystack secret key based on environment
async function getPaystackSecretKey(supabaseClient: SupabaseClient): Promise<{ key: string; environment: string }> {
  const { data: envSetting } = await supabaseClient
    .from('platform_settings')
    .select('value')
    .eq('key', 'platform_environment')
    .single();

  const environment = (envSetting?.value as string) || 'development';
  
  const key = environment === 'production'
    ? Deno.env.get('PAYSTACK_LIVE_SECRET_KEY') || Deno.env.get('PAYSTACK_SECRET_KEY')!
    : Deno.env.get('PAYSTACK_TEST_SECRET_KEY') || Deno.env.get('PAYSTACK_SECRET_KEY')!;

  console.log(`Using ${environment} Paystack keys`);
  return { key, environment };
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Get the authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create Supabase client with user's token
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get user from token
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    
    if (userError || !user) {
      console.error('Auth error:', userError);
      return new Response(
        JSON.stringify({ error: 'Invalid user token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { orderId, callbackUrl } = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'Order ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get environment-specific Paystack key
    const { key: paystackSecretKey, environment } = await getPaystackSecretKey(supabaseClient);

    console.log(`Initializing payment for order: ${orderId} in ${environment} mode`);

    // Fetch order details
    const { data: order, error: orderError } = await supabaseClient
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .eq('user_id', user.id)
      .single();

    if (orderError || !order) {
      console.error('Order fetch error:', orderError);
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.payment_status === 'paid') {
      return new Response(
        JSON.stringify({ error: 'Order already paid' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Initialize Paystack transaction
    const paystackResponse = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${paystackSecretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: user.email,
        amount: Math.round(order.total * 100), // Paystack expects amount in kobo
        reference: `FC-${order.order_number}-${Date.now()}`,
        callback_url: callbackUrl || `${req.headers.get('origin')}/payment-callback`,
        metadata: {
          order_id: orderId,
          order_number: order.order_number,
          user_id: user.id,
          environment: environment, // Track which environment this payment is for
        },
      }),
    });

    const paystackData = await paystackResponse.json();

    if (!paystackData.status) {
      console.error('Paystack error:', paystackData);
      return new Response(
        JSON.stringify({ error: paystackData.message || 'Payment initialization failed' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Payment initialized successfully. Reference: ${paystackData.data.reference}`);

    // Update order with payment reference and environment
    await supabaseClient
      .from('orders')
      .update({ 
        payment_reference: paystackData.data.reference,
        payment_method: 'paystack',
        environment: environment, // Store which environment this order was created in
      })
      .eq('id', orderId);

    return new Response(
      JSON.stringify({
        success: true,
        authorization_url: paystackData.data.authorization_url,
        access_code: paystackData.data.access_code,
        reference: paystackData.data.reference,
        environment: environment,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error initializing payment:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
