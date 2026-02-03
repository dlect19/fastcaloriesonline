import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AcceptDispatchRequest {
  offerId: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the authorization header to identify the rider
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the user
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { offerId }: AcceptDispatchRequest = await req.json();

    if (!offerId) {
      return new Response(
        JSON.stringify({ error: 'Offer ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Rider ${user.id} attempting to accept offer ${offerId}`);

    // Get the offer details
    const { data: offer, error: offerError } = await supabase
      .from('dispatch_offers')
      .select(`
        id,
        dispatch_request_id,
        rider_user_id,
        rider_profile_id,
        status,
        expires_at,
        dispatch_requests (
          id,
          order_id,
          status,
          vendor_id
        )
      `)
      .eq('id', offerId)
      .single();

    if (offerError || !offer) {
      console.error('Offer not found:', offerError);
      return new Response(
        JSON.stringify({ error: 'Offer not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the rider is the one who received this offer
    if (offer.rider_user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'This offer is not assigned to you' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if offer is still pending
    if (offer.status !== 'pending') {
      return new Response(
        JSON.stringify({ 
          error: 'Offer is no longer available',
          status: offer.status 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if offer has expired
    if (new Date(offer.expires_at) < new Date()) {
      // Mark as expired
      await supabase
        .from('dispatch_offers')
        .update({ status: 'expired', responded_at: new Date().toISOString() })
        .eq('id', offerId);

      return new Response(
        JSON.stringify({ error: 'Offer has expired' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const dispatchRequest = offer.dispatch_requests as any;
    
    // Check if dispatch request is still pending
    if (dispatchRequest.status !== 'pending') {
      // Mark this offer as superseded since someone else got it
      await supabase
        .from('dispatch_offers')
        .update({ status: 'superseded', responded_at: new Date().toISOString() })
        .eq('id', offerId);

      return new Response(
        JSON.stringify({ 
          error: 'Order already taken by another rider',
          alreadyTaken: true 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ATOMIC ACCEPTANCE: Use a transaction to prevent race conditions
    // First, try to update the dispatch request with a WHERE clause that checks status
    const { data: updatedDispatch, error: dispatchUpdateError } = await supabase
      .from('dispatch_requests')
      .update({
        status: 'accepted',
        accepted_by_rider_id: user.id,
        accepted_by_rider_profile_id: offer.rider_profile_id,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', dispatchRequest.id)
      .eq('status', 'pending') // Only update if still pending (optimistic locking)
      .select()
      .single();

    if (dispatchUpdateError || !updatedDispatch) {
      // Race condition: another rider accepted first
      console.log('Race condition detected, another rider accepted first');
      
      // Mark this offer as superseded
      await supabase
        .from('dispatch_offers')
        .update({ status: 'superseded', responded_at: new Date().toISOString() })
        .eq('id', offerId);

      return new Response(
        JSON.stringify({ 
          error: 'Order already taken by another rider',
          alreadyTaken: true 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Rider ${user.id} successfully locked dispatch ${dispatchRequest.id}`);

    // Update the offer as accepted
    await supabase
      .from('dispatch_offers')
      .update({ 
        status: 'accepted', 
        responded_at: new Date().toISOString() 
      })
      .eq('id', offerId);

    // Mark all other offers for this dispatch as superseded
    await supabase
      .from('dispatch_offers')
      .update({ 
        status: 'superseded', 
        responded_at: new Date().toISOString() 
      })
      .eq('dispatch_request_id', dispatchRequest.id)
      .neq('id', offerId);

    // Update the order with the assigned rider
    const { error: orderUpdateError } = await supabase
      .from('orders')
      .update({
        rider_id: user.id,
        status: 'assigned',
        updated_at: new Date().toISOString(),
      })
      .eq('id', dispatchRequest.order_id);

    if (orderUpdateError) {
      console.error('Error updating order:', orderUpdateError);
      // Don't fail the whole request, the dispatch is already accepted
    }

    console.log(`Order ${dispatchRequest.order_id} assigned to rider ${user.id}`);

    return new Response(
      JSON.stringify({
        success: true,
        orderId: dispatchRequest.order_id,
        message: 'Successfully accepted delivery',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in accept-dispatch:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
