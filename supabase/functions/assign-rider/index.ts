import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AssignRiderRequest {
  orderId: string;
  riderId?: string; // Optional - if not provided, find nearest rider
}

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

    console.log(`Assigning rider to order ${orderId}`);

    // Get order details
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('id, vendor_id, status, rider_id, delivery_type, vendors(latitude, longitude, delivery_mode, own_rider_priority)')
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

    let assignedRiderId = riderId;

    // If no rider specified, find nearest available rider
    if (!assignedRiderId) {
      const vendorData = order.vendors as any;
      if (!vendorData?.latitude || !vendorData?.longitude) {
        return new Response(
          JSON.stringify({ error: 'Vendor location not set' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Find nearby riders
      const { data: riderSettings } = await supabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'rider_search_radius_km')
        .single();

      const searchRadius = parseFloat(riderSettings?.value || '5');

      // Get vendor's affiliated riders from vendor_riders table
      const { data: vendorRiders } = await supabase
        .from('vendor_riders')
        .select('rider_profile_id')
        .eq('vendor_id', order.vendor_id)
        .eq('is_active', true);

      const vendorRiderProfileIds = (vendorRiders || []).map(vr => vr.rider_profile_id);
      console.log(`Found ${vendorRiderProfileIds.length} affiliated riders for vendor ${order.vendor_id}`);

      // Fetch online riders with work preferences
      // Include verified riders who are online and have email verified
      const { data: riders } = await supabase
        .from('rider_profiles')
        .select('id, user_id, current_latitude, current_longitude, affiliated_vendor_id, preferred_latitude, preferred_longitude, work_radius_km, nin_number, nin_verified, is_email_verified')
        .eq('is_online', true)
        .eq('is_verified', true)
        .eq('is_email_verified', true);

      if (!riders || riders.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No available riders', success: false }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Calculate distances and find nearest
      const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
      };

      const ridersWithDistance = riders
        .filter(rider => {
          // Must have either current location or preferred location
          const hasCurrentLocation = rider.current_latitude && rider.current_longitude;
          const hasPreferredLocation = rider.preferred_latitude && rider.preferred_longitude;
          return hasCurrentLocation || hasPreferredLocation;
        })
        .map(rider => {
          // Use current location if available, otherwise use preferred location
          const riderLat = rider.current_latitude || rider.preferred_latitude;
          const riderLon = rider.current_longitude || rider.preferred_longitude;
          
          const distance = calculateDistance(
            vendorData.latitude,
            vendorData.longitude,
            riderLat!,
            riderLon!
          );
          
          // Check if vendor is within rider's work radius
          const riderWorkRadius = rider.work_radius_km || searchRadius;
          const withinWorkRadius = distance <= riderWorkRadius;
          
          // Check if rider is affiliated via vendor_riders table OR affiliated_vendor_id
          const isAffiliatedViaTable = vendorRiderProfileIds.includes(rider.id);
          const isAffiliatedViaColumn = rider.affiliated_vendor_id === order.vendor_id;
          const isAffiliated = isAffiliatedViaTable || isAffiliatedViaColumn;
          
          return {
            ...rider,
            distance,
            isAffiliated,
            withinWorkRadius,
          };
        })
        .filter(r => r.distance <= searchRadius && r.withinWorkRadius)
        .sort((a, b) => {
          // Prioritize vendor's own riders if configured
          if (vendorData.own_rider_priority) {
            if (a.isAffiliated && !b.isAffiliated) return -1;
            if (!a.isAffiliated && b.isAffiliated) return 1;
          }
          return a.distance - b.distance;
        });

      if (ridersWithDistance.length === 0) {
        return new Response(
          JSON.stringify({ error: 'No riders within delivery radius', success: false }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get the user_id of the nearest rider
      assignedRiderId = ridersWithDistance[0].user_id;
      const isAffiliated = ridersWithDistance[0].isAffiliated;
      console.log(`Auto-assigned ${isAffiliated ? 'affiliated ' : ''}rider: ${assignedRiderId} (${ridersWithDistance[0].distance.toFixed(2)}km away)`);
    }

    // Update order with assigned rider
    const { error: updateError } = await supabase
      .from('orders')
      .update({
        rider_id: assignedRiderId,
        status: 'ready_for_pickup',
        updated_at: new Date().toISOString(),
      })
      .eq('id', orderId);

    if (updateError) {
      console.error('Error updating order:', updateError);
      throw updateError;
    }

    console.log(`Rider ${assignedRiderId} assigned to order ${orderId}`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        riderId: assignedRiderId,
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
