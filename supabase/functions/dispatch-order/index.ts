import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DispatchOrderRequest {
  orderId: string;
}

interface EligibleRider {
  id: string;
  user_id: string;
  distance_km: number;
  priority_tier: 'vendor_riders' | 'delivery_company_riders' | 'platform_riders';
  current_latitude: number | null;
  current_longitude: number | null;
  preferred_latitude: number | null;
  preferred_longitude: number | null;
}

// Haversine formula for distance calculation
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) *
    Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

async function getDispatchSettings(supabase: any) {
  const settingsKeys = [
    'dispatch_acceptance_timeout_seconds',
    'dispatch_initial_radius_km',
    'dispatch_max_retries',
    'dispatch_enable_priority_tiers',
    'dispatch_priority_tier_timeout_seconds'
  ];
  
  const { data } = await supabase
    .from('platform_settings')
    .select('key, value')
    .in('key', settingsKeys);
  
  const settings: Record<string, string> = {};
  data?.forEach((s: any) => { settings[s.key] = s.value; });
  
  return {
    acceptanceTimeoutSeconds: parseInt(settings.dispatch_acceptance_timeout_seconds || '60'),
    initialRadiusKm: parseFloat(settings.dispatch_initial_radius_km || '5'),
    maxRetries: parseInt(settings.dispatch_max_retries || '3'),
    enablePriorityTiers: settings.dispatch_enable_priority_tiers !== 'false',
    tierTimeoutSeconds: parseInt(settings.dispatch_priority_tier_timeout_seconds || '30'),
  };
}

async function findEligibleRiders(
  supabase: any,
  vendorId: string,
  vendorLat: number,
  vendorLon: number,
  radiusKm: number,
  priorityTier: string
): Promise<EligibleRider[]> {
  console.log(`Finding ${priorityTier} riders within ${radiusKm}km of vendor`);
  
  // Get vendor's affiliated riders from vendor_riders table
  const { data: vendorRiders } = await supabase
    .from('vendor_riders')
    .select('rider_profile_id')
    .eq('vendor_id', vendorId)
    .eq('is_active', true);
  
  const vendorRiderProfileIds = (vendorRiders || []).map((vr: any) => vr.rider_profile_id);
  
  // Fetch online, verified riders with email verified
  const { data: riders, error } = await supabase
    .from('rider_profiles')
    .select('id, user_id, current_latitude, current_longitude, preferred_latitude, preferred_longitude, work_radius_km, affiliated_vendor_id, delivery_company_id, nin_number')
    .eq('is_online', true)
    .eq('is_verified', true)
    .eq('is_email_verified', true)
    .not('nin_number', 'is', null);
  
  if (error || !riders) {
    console.error('Error fetching riders:', error);
    return [];
  }
  
  const eligibleRiders: EligibleRider[] = [];
  
  for (const rider of riders) {
    // Determine rider's priority tier
    const isVendorRider = vendorRiderProfileIds.includes(rider.id) || rider.affiliated_vendor_id === vendorId;
    const isDeliveryCompanyRider = !!rider.delivery_company_id;
    const isPlatformRider = !isVendorRider && !isDeliveryCompanyRider;
    
    let riderTier: 'vendor_riders' | 'delivery_company_riders' | 'platform_riders';
    if (isVendorRider) {
      riderTier = 'vendor_riders';
    } else if (isDeliveryCompanyRider) {
      riderTier = 'delivery_company_riders';
    } else {
      riderTier = 'platform_riders';
    }
    
    // Filter by requested priority tier
    if (priorityTier !== 'all' && riderTier !== priorityTier) {
      continue;
    }
    
    // Get rider location (current or preferred)
    const riderLat = rider.current_latitude || rider.preferred_latitude;
    const riderLon = rider.current_longitude || rider.preferred_longitude;
    
    if (!riderLat || !riderLon) continue;
    
    const distance = calculateDistance(vendorLat, vendorLon, riderLat, riderLon);
    
    // Check if within search radius AND rider's work radius
    const riderWorkRadius = rider.work_radius_km || radiusKm;
    if (distance <= radiusKm && distance <= riderWorkRadius) {
      eligibleRiders.push({
        id: rider.id,
        user_id: rider.user_id,
        distance_km: distance,
        priority_tier: riderTier,
        current_latitude: rider.current_latitude,
        current_longitude: rider.current_longitude,
        preferred_latitude: rider.preferred_latitude,
        preferred_longitude: rider.preferred_longitude,
      });
    }
  }
  
  // Sort by distance
  return eligibleRiders.sort((a, b) => a.distance_km - b.distance_km);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { orderId }: DispatchOrderRequest = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'Order ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting dispatch for order ${orderId}`);

    // Get order details with vendor info
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id, 
        vendor_id, 
        status, 
        rider_id, 
        delivery_type,
        delivery_fee,
        delivery_address_text,
        environment,
        vendors (
          id,
          name,
          address,
          latitude,
          longitude
        ),
        addresses (
          latitude,
          longitude
        )
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Order not found:', orderError);
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Skip dispatch for self-pickup orders
    if (order.delivery_type === 'self_pickup') {
      console.log('Self-pickup order, skipping dispatch');
      return new Response(
        JSON.stringify({ success: true, message: 'Self-pickup order, no rider needed' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if order already has a rider
    if (order.rider_id) {
      return new Response(
        JSON.stringify({ error: 'Order already has a rider assigned', riderId: order.rider_id }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check for existing active dispatch request
    const { data: existingDispatch } = await supabase
      .from('dispatch_requests')
      .select('id, status')
      .eq('order_id', orderId)
      .in('status', ['pending'])
      .single();

    if (existingDispatch) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          dispatchRequestId: existingDispatch.id,
          message: 'Dispatch already in progress' 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const vendor = order.vendors as any;
    if (!vendor?.latitude || !vendor?.longitude) {
      return new Response(
        JSON.stringify({ error: 'Vendor location not set' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get dispatch settings
    const settings = await getDispatchSettings(supabase);
    
    // Determine initial priority tier
    const initialTier = settings.enablePriorityTiers ? 'vendor_riders' : 'platform_riders';
    
    // Find eligible riders for the initial tier
    let eligibleRiders = await findEligibleRiders(
      supabase,
      order.vendor_id,
      vendor.latitude,
      vendor.longitude,
      settings.initialRadiusKm,
      settings.enablePriorityTiers ? initialTier : 'all'
    );

    // If no vendor riders and priority tiers enabled, try delivery company riders
    if (eligibleRiders.length === 0 && settings.enablePriorityTiers) {
      console.log('No vendor riders found, trying delivery company riders');
      eligibleRiders = await findEligibleRiders(
        supabase,
        order.vendor_id,
        vendor.latitude,
        vendor.longitude,
        settings.initialRadiusKm,
        'delivery_company_riders'
      );
    }

    // If still no riders, try platform riders
    if (eligibleRiders.length === 0 && settings.enablePriorityTiers) {
      console.log('No delivery company riders found, trying platform riders');
      eligibleRiders = await findEligibleRiders(
        supabase,
        order.vendor_id,
        vendor.latitude,
        vendor.longitude,
        settings.initialRadiusKm,
        'platform_riders'
      );
    }

    // If no priority tiers, get all riders
    if (!settings.enablePriorityTiers && eligibleRiders.length === 0) {
      eligibleRiders = await findEligibleRiders(
        supabase,
        order.vendor_id,
        vendor.latitude,
        vendor.longitude,
        settings.initialRadiusKm,
        'all'
      );
    }

    console.log(`Found ${eligibleRiders.length} eligible riders`);

    // Get customer location from address if available
    const address = order.addresses as any;
    const customerLat = address?.latitude || null;
    const customerLon = address?.longitude || null;

    // Create dispatch request
    const expiresAt = new Date(Date.now() + settings.acceptanceTimeoutSeconds * 1000);
    const currentTier = eligibleRiders.length > 0 ? eligibleRiders[0].priority_tier : initialTier;

    const { data: dispatchRequest, error: dispatchError } = await supabase
      .from('dispatch_requests')
      .insert({
        order_id: orderId,
        vendor_id: order.vendor_id,
        vendor_latitude: vendor.latitude,
        vendor_longitude: vendor.longitude,
        customer_latitude: customerLat,
        customer_longitude: customerLon,
        search_radius_km: settings.initialRadiusKm,
        priority_tier: currentTier,
        delivery_fee: order.delivery_fee || 0,
        expires_at: expiresAt.toISOString(),
        max_retries: settings.maxRetries,
        environment: order.environment || 'production',
        status: eligibleRiders.length === 0 ? 'no_riders' : 'pending',
      })
      .select()
      .single();

    if (dispatchError) {
      console.error('Error creating dispatch request:', dispatchError);
      throw dispatchError;
    }

    console.log(`Created dispatch request ${dispatchRequest.id}`);

    // Create dispatch offers for each eligible rider
    const deliveryFee = order.delivery_fee || 0;
    const riderSharePct = 0.80; // 80% to rider
    const riderShare = Math.round(deliveryFee * riderSharePct);

    const offers = eligibleRiders.map(rider => ({
      dispatch_request_id: dispatchRequest.id,
      rider_user_id: rider.user_id,
      rider_profile_id: rider.id,
      distance_km: Math.round(rider.distance_km * 100) / 100,
      delivery_fee: deliveryFee,
      rider_share: riderShare,
      priority_tier: rider.priority_tier,
      vendor_name: vendor.name,
      vendor_address: vendor.address,
      customer_address: order.delivery_address_text,
      estimated_pickup_minutes: Math.ceil((rider.distance_km / 25) * 60),
      estimated_delivery_minutes: customerLat && customerLon 
        ? Math.ceil((rider.distance_km / 25) * 60) + Math.ceil((calculateDistance(vendor.latitude, vendor.longitude, customerLat, customerLon) / 25) * 60)
        : null,
      expires_at: expiresAt.toISOString(),
      status: 'pending',
    }));

    if (offers.length > 0) {
      const { error: offersError } = await supabase
        .from('dispatch_offers')
        .insert(offers);

      if (offersError) {
        console.error('Error creating dispatch offers:', offersError);
      } else {
        console.log(`Created ${offers.length} dispatch offers`);
      }
    }

    // Update order status to searching_for_rider
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        status: 'searching_for_rider',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('Error updating order status:', updateError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        dispatchRequestId: dispatchRequest.id,
        eligibleRiderCount: eligibleRiders.length,
        expiresAt: expiresAt.toISOString(),
        message: eligibleRiders.length === 0 
          ? 'No riders available, dispatch created for retry'
          : `Dispatched to ${eligibleRiders.length} riders`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in dispatch-order:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
