import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DeclineDispatchRequest {
  offerId: string;
  reason?: string;
}

// Haversine formula for distance calculation
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

async function escalateToNextTier(
  supabase: any,
  dispatchRequest: any,
  currentTier: string
): Promise<boolean> {
  const tierOrder = ['vendor_riders', 'delivery_company_riders', 'platform_riders'];
  const currentIndex = tierOrder.indexOf(currentTier);
  
  if (currentIndex >= tierOrder.length - 1) {
    console.log('Already at last tier, cannot escalate further');
    return false;
  }

  const nextTier = tierOrder[currentIndex + 1];
  console.log(`Escalating from ${currentTier} to ${nextTier}`);

  // Get dispatch settings and vehicle configs
  const [{ data: settings }, { data: vehicleConfigs }] = await Promise.all([
    supabase.from('platform_settings').select('key, value').in('key', ['dispatch_acceptance_timeout_seconds']),
    supabase.from('vehicle_type_configs').select('vehicle_type, dispatch_radius_km').eq('is_active', true),
  ]);
  
  const settingsMap: Record<string, string> = {};
  settings?.forEach((s: any) => { settingsMap[s.key] = s.value; });
  const timeoutSeconds = parseInt(settingsMap.dispatch_acceptance_timeout_seconds || '60');

  const vehicleDispatchRadii: Record<string, number | null> = {};
  (vehicleConfigs || []).forEach((c: any) => {
    vehicleDispatchRadii[c.vehicle_type] = c.dispatch_radius_km;
  });

  // Find riders for the next tier
  const { data: riders } = await supabase
    .from('rider_profiles')
    .select('id, user_id, current_latitude, current_longitude, preferred_latitude, preferred_longitude, work_radius_km, delivery_company_id, affiliated_vendor_id, vehicle_type')
    .eq('is_online', true)
    .eq('is_verified', true)
    .eq('is_email_verified', true)
    .not('nin_number', 'is', null);

  if (!riders || riders.length === 0) {
    return false;
  }

  // Get vendor info for the order
  const { data: order } = await supabase
    .from('orders')
    .select('vendor_id, delivery_fee, delivery_address_text, vendors(name, address)')
    .eq('id', dispatchRequest.order_id)
    .single();

  if (!order) return false;

  // Get vendor riders for filtering
  const { data: vendorRiders } = await supabase
    .from('vendor_riders')
    .select('rider_profile_id')
    .eq('vendor_id', dispatchRequest.vendor_id)
    .eq('is_active', true);

  const vendorRiderProfileIds = (vendorRiders || []).map((vr: any) => vr.rider_profile_id);

  const eligibleRiders = riders.filter((rider: any) => {
    const isVendorRider = vendorRiderProfileIds.includes(rider.id) || rider.affiliated_vendor_id === dispatchRequest.vendor_id;
    const isDeliveryCompanyRider = !!rider.delivery_company_id;
    
    if (nextTier === 'delivery_company_riders' && !isDeliveryCompanyRider) return false;
    if (nextTier === 'platform_riders' && (isVendorRider || isDeliveryCompanyRider)) return false;
    
    // Check distance
    const riderLat = rider.current_latitude || rider.preferred_latitude;
    const riderLon = rider.current_longitude || rider.preferred_longitude;
    if (!riderLat || !riderLon) return false;
    
    const distance = calculateDistance(
      dispatchRequest.vendor_latitude,
      dispatchRequest.vendor_longitude,
      riderLat,
      riderLon
    );
    
    const riderWorkRadius = rider.work_radius_km || dispatchRequest.search_radius_km;
    return distance <= dispatchRequest.search_radius_km && distance <= riderWorkRadius;
  });

  if (eligibleRiders.length === 0) {
    console.log(`No riders found for tier ${nextTier}`);
    // Try next tier
    return escalateToNextTier(supabase, dispatchRequest, nextTier);
  }

  // Update dispatch request to next tier
  const newExpiresAt = new Date(Date.now() + timeoutSeconds * 1000);
  
  await supabase
    .from('dispatch_requests')
    .update({
      priority_tier: nextTier,
      expires_at: newExpiresAt.toISOString(),
    })
    .eq('id', dispatchRequest.id);

  // Create new offers for next tier riders
  const deliveryFee = order.delivery_fee || 0;
  const riderShare = Math.round(deliveryFee * 0.80);
  const vendor = order.vendors as any;

  const offers = eligibleRiders.map((rider: any) => {
    const riderLat = rider.current_latitude || rider.preferred_latitude;
    const riderLon = rider.current_longitude || rider.preferred_longitude;
    const distance = calculateDistance(
      dispatchRequest.vendor_latitude,
      dispatchRequest.vendor_longitude,
      riderLat,
      riderLon
    );

    return {
      dispatch_request_id: dispatchRequest.id,
      rider_user_id: rider.user_id,
      rider_profile_id: rider.id,
      distance_km: Math.round(distance * 100) / 100,
      delivery_fee: deliveryFee,
      rider_share: riderShare,
      priority_tier: nextTier,
      vendor_name: vendor?.name,
      vendor_address: vendor?.address,
      customer_address: order.delivery_address_text,
      estimated_pickup_minutes: Math.ceil((distance / 25) * 60),
      expires_at: newExpiresAt.toISOString(),
      status: 'pending',
    };
  });

  const { error: offersError } = await supabase
    .from('dispatch_offers')
    .insert(offers);

  if (offersError) {
    console.error('Error creating escalation offers:', offersError);
    return false;
  }

  console.log(`Created ${offers.length} offers for tier ${nextTier}`);
  return true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get the authorization header
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

    const { offerId, reason }: DeclineDispatchRequest = await req.json();

    if (!offerId) {
      return new Response(
        JSON.stringify({ error: 'Offer ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Rider ${user.id} declining offer ${offerId}`);

    // Get the offer
    const { data: offer, error: offerError } = await supabase
      .from('dispatch_offers')
      .select(`
        id,
        dispatch_request_id,
        rider_user_id,
        priority_tier,
        status,
        dispatch_requests (
          id,
          order_id,
          status,
          vendor_id,
          vendor_latitude,
          vendor_longitude,
          search_radius_km,
          priority_tier
        )
      `)
      .eq('id', offerId)
      .single();

    if (offerError || !offer) {
      return new Response(
        JSON.stringify({ error: 'Offer not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify ownership
    if (offer.rider_user_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'This offer is not assigned to you' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already responded
    if (offer.status !== 'pending') {
      return new Response(
        JSON.stringify({ error: 'Offer already responded to', status: offer.status }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Mark offer as declined
    await supabase
      .from('dispatch_offers')
      .update({ 
        status: 'declined', 
        responded_at: new Date().toISOString() 
      })
      .eq('id', offerId);

    const dispatchRequest = offer.dispatch_requests as any;

    // Check if there are still pending offers for this dispatch
    const { data: pendingOffers, error: pendingError } = await supabase
      .from('dispatch_offers')
      .select('id')
      .eq('dispatch_request_id', dispatchRequest.id)
      .eq('status', 'pending');

    if (pendingError) {
      console.error('Error checking pending offers:', pendingError);
    }

    // If no more pending offers in current tier, try to escalate
    if (!pendingOffers || pendingOffers.length === 0) {
      console.log('No more pending offers, checking for tier escalation');
      
      // Check if priority tiers are enabled
      const { data: tierSetting } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'dispatch_enable_priority_tiers')
        .single();

      if (tierSetting?.value !== 'false') {
        const escalated = await escalateToNextTier(supabase, dispatchRequest, dispatchRequest.priority_tier);
        
        if (!escalated) {
          console.log('Could not escalate, marking dispatch as no_riders');
          await supabase
            .from('dispatch_requests')
            .update({ status: 'no_riders' })
            .eq('id', dispatchRequest.id);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Offer declined',
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in decline-dispatch:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
