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

    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

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

    // Get the offer details including payout breakdown
    const { data: offer, error: offerError } = await supabase
      .from('dispatch_offers')
      .select(`
        id, dispatch_request_id, rider_user_id, rider_profile_id,
        status, expires_at, delivery_fee, rider_share, distance_km,
        platform_fee, distance_bonus, time_surge_bonus, weather_surge_bonus,
        total_surge_bonus, subsidy_amount, weather_condition, time_period,
        dispatch_requests (id, order_id, status, vendor_id)
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

    if (offer.rider_user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'This offer is not assigned to you' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (offer.status !== 'pending') {
      return new Response(
        JSON.stringify({ error: 'Offer is no longer available', status: offer.status }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (new Date(offer.expires_at) < new Date()) {
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

    if (dispatchRequest.status !== 'pending') {
      await supabase
        .from('dispatch_offers')
        .update({ status: 'superseded', responded_at: new Date().toISOString() })
        .eq('id', offerId);

      return new Response(
        JSON.stringify({ error: 'Order already taken by another rider', alreadyTaken: true }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ATOMIC ACCEPTANCE
    const { data: updatedDispatch, error: dispatchUpdateError } = await supabase
      .from('dispatch_requests')
      .update({
        status: 'accepted',
        accepted_by_rider_id: user.id,
        accepted_by_rider_profile_id: offer.rider_profile_id,
        accepted_at: new Date().toISOString(),
      })
      .eq('id', dispatchRequest.id)
      .eq('status', 'pending')
      .select()
      .single();

    if (dispatchUpdateError || !updatedDispatch) {
      console.log('Race condition detected, another rider accepted first');
      await supabase
        .from('dispatch_offers')
        .update({ status: 'superseded', responded_at: new Date().toISOString() })
        .eq('id', offerId);

      return new Response(
        JSON.stringify({ error: 'Order already taken by another rider', alreadyTaken: true }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Rider ${user.id} successfully locked dispatch ${dispatchRequest.id}`);

    // Update the offer as accepted
    await supabase
      .from('dispatch_offers')
      .update({ status: 'accepted', responded_at: new Date().toISOString() })
      .eq('id', offerId);

    // Mark all other offers as superseded
    await supabase
      .from('dispatch_offers')
      .update({ status: 'superseded', responded_at: new Date().toISOString() })
      .eq('dispatch_request_id', dispatchRequest.id)
      .neq('id', offerId);

    // Update the order with assigned rider
    await supabase
      .from('orders')
      .update({
        rider_id: user.id,
        status: 'assigned',
        updated_at: new Date().toISOString(),
      })
      .eq('id', dispatchRequest.order_id);

    // Get the order environment
    const { data: orderData } = await supabase
      .from('orders')
      .select('environment')
      .eq('id', dispatchRequest.order_id)
      .single();

    // Record rider payout details for audit trail
    await supabase.from('rider_payout_details').insert({
      order_id: dispatchRequest.order_id,
      rider_user_id: user.id,
      delivery_fee: offer.delivery_fee || 0,
      distance_km: offer.distance_km || 0,
      platform_fee: offer.platform_fee || 0,
      distance_bonus: offer.distance_bonus || 0,
      time_surge_bonus: offer.time_surge_bonus || 0,
      weather_surge_bonus: offer.weather_surge_bonus || 0,
      total_surge_bonus: offer.total_surge_bonus || 0,
      raw_rider_pay: (offer.rider_share || 0) - (offer.subsidy_amount || 0),
      subsidy_amount: offer.subsidy_amount || 0,
      final_rider_pay: offer.rider_share || 0,
      weather_condition: offer.weather_condition || 'clear',
      time_period: offer.time_period || 'morning',
      environment: orderData?.environment || 'production',
    });

    console.log(`Order ${dispatchRequest.order_id} assigned to rider ${user.id}, payout: ₦${offer.rider_share}`);

    return new Response(
      JSON.stringify({
        success: true,
        orderId: dispatchRequest.order_id,
        message: 'Successfully accepted delivery',
        payoutDetails: {
          deliveryFee: offer.delivery_fee,
          platformFee: offer.platform_fee,
          distanceBonus: offer.distance_bonus,
          timeSurgeBonus: offer.time_surge_bonus,
          weatherSurgeBonus: offer.weather_surge_bonus,
          totalSurgeBonus: offer.total_surge_bonus,
          subsidyAmount: offer.subsidy_amount,
          finalRiderPay: offer.rider_share,
        },
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
