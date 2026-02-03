import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AssignRiderRequest {
  orderId: string;
  riderId: string; // Now REQUIRED - no auto-assignment
}

/**
 * MANUAL RIDER ASSIGNMENT ONLY
 * 
 * This function is ONLY for explicit manual assignment by vendors.
 * It does NOT auto-find riders anymore.
 * 
 * For platform rider dispatch, use the dispatch-order function instead.
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { orderId, riderId }: AssignRiderRequest = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'Order ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // IMPORTANT: riderId is now REQUIRED - no auto-assignment
    if (!riderId) {
      console.log('No riderId provided - auto-assignment is disabled. Use dispatch-order for platform riders.');
      return new Response(
        JSON.stringify({ 
          error: 'Rider ID is required. Auto-assignment is disabled.',
          message: 'For platform rider dispatch, use the dispatch-order function instead.',
          success: false 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Manually assigning rider ${riderId} to order ${orderId}`);

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, vendor_id, status, rider_id, delivery_type')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Order not found:', orderError);
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Skip rider assignment for self-pickup orders
    if (order.delivery_type === 'self_pickup') {
      console.log('Self-pickup order, skipping rider assignment');
      return new Response(
        JSON.stringify({ success: true, message: 'Self-pickup order, no rider needed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.rider_id) {
      return new Response(
        JSON.stringify({ error: 'Order already has a rider assigned', riderId: order.rider_id }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update order with assigned rider
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        rider_id: riderId,
        status: 'assigned',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('Error updating order:', updateError);
      throw updateError;
    }

    console.log(`Rider ${riderId} manually assigned to order ${orderId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        riderId: riderId,
        message: 'Rider assigned successfully',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error assigning rider:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
