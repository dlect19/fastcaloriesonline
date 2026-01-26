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
      .select('id, vendor_id, status, rider_id, vendors(latitude, longitude, delivery_mode, own_rider_priority)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Order not found:', orderError);
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

      // Fetch online riders
      const { data: riders } = await supabase
        .from('rider_profiles')
        .select('id, user_id, current_latitude, current_longitude, affiliated_vendor_id')
        .eq('is_online', true)
        .eq('is_verified', true)
        .not('current_latitude', 'is', null)
        .not('current_longitude', 'is', null);

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
        .map(rider => ({
          ...rider,
          distance: calculateDistance(
            vendorData.latitude,
            vendorData.longitude,
            rider.current_latitude!,
            rider.current_longitude!
          ),
          isAffiliated: rider.affiliated_vendor_id === order.vendor_id,
        }))
        .filter(r => r.distance <= searchRadius)
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
      console.log(`Auto-assigned nearest rider: ${assignedRiderId} (${ridersWithDistance[0].distance.toFixed(2)}km away)`);
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
