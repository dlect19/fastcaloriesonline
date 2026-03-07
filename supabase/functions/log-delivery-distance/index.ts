import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { orderId, riderId } = await req.json();

    if (!orderId || !riderId) {
      return new Response(JSON.stringify({ error: 'orderId and riderId required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check if already logged
    const { data: existing } = await supabase
      .from('rider_distance_logs')
      .select('id')
      .eq('order_id', orderId)
      .eq('rider_user_id', riderId)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({ message: 'Already logged', distanceKm: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let distanceKm = 0;
    let originLat: number | null = null;
    let originLng: number | null = null;
    let destLat: number | null = null;
    let destLng: number | null = null;

    // Step 1: Find dispatch_request for this order (vendor-to-customer coordinates)
    const { data: request } = await supabase
      .from('dispatch_requests')
      .select('id, vendor_latitude, vendor_longitude, customer_latitude, customer_longitude')
      .eq('order_id', orderId)
      .maybeSingle();

    // Note: dispatch_offers.distance_km is rider-to-vendor distance, NOT delivery distance.
    // We always calculate vendor-to-customer distance instead.

    // Collect vendor-to-customer coordinates from dispatch_request
    if (request?.vendor_latitude && request?.vendor_longitude && request?.customer_latitude && request?.customer_longitude) {
      originLat = request.vendor_latitude;
      originLng = request.vendor_longitude;
      destLat = request.customer_latitude;
      destLng = request.customer_longitude;
    }

    // Step 3: Fallback to order's address vs vendor
    if (!originLat && !distanceKm) {
      const { data: order } = await supabase
        .from('orders')
        .select('vendor_id, delivery_address_id')
        .eq('id', orderId)
        .maybeSingle();

      if (order?.delivery_address_id && order?.vendor_id) {
        const [{ data: address }, { data: vendor }] = await Promise.all([
          supabase.from('addresses').select('latitude, longitude').eq('id', order.delivery_address_id).maybeSingle(),
          supabase.from('vendors').select('latitude, longitude').eq('id', order.vendor_id).maybeSingle(),
        ]);

        if (address?.latitude && address?.longitude && vendor?.latitude && vendor?.longitude) {
          originLat = vendor.latitude;
          originLng = vendor.longitude;
          destLat = address.latitude;
          destLng = address.longitude;
        }
      }
    }

    // Step 4: Calculate distance using Google Maps API or Haversine fallback
    if (!distanceKm && originLat && originLng && destLat && destLng) {
      // Try Google Maps Distance Matrix
      try {
        const googleRes = await supabase.functions.invoke('calculate-distance', {
          body: { originLat, originLng, destLat, destLng },
        });

        if (googleRes.data?.distanceInKm) {
          distanceKm = googleRes.data.distanceInKm;
          console.log(`Google Maps distance for order ${orderId}: ${distanceKm} km`);
        }
      } catch (err) {
        console.warn('Google Maps distance failed:', err);
      }

      // Haversine fallback
      if (!distanceKm) {
        const R = 6371;
        const dLat = (destLat - originLat) * Math.PI / 180;
        const dLon = (destLng - originLng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(originLat * Math.PI / 180) * Math.cos(destLat * Math.PI / 180) *
          Math.sin(dLon / 2) ** 2;
        distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        console.log(`Haversine fallback for order ${orderId}: ${Math.round(distanceKm * 10) / 10} km`);
      }
    }

    if (distanceKm > 0) {
      const env = (await supabase.from('platform_settings').select('value').eq('key', 'platform_environment').single()).data?.value || 'production';

      await supabase.from('rider_distance_logs').insert({
        rider_user_id: riderId,
        order_id: orderId,
        distance_km: Math.round(distanceKm * 10) / 10,
        environment: env,
      });

      console.log(`Distance logged for order ${orderId}: ${Math.round(distanceKm * 10) / 10} km`);

      return new Response(JSON.stringify({ success: true, distanceKm: Math.round(distanceKm * 10) / 10 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.warn(`Could not determine distance for order ${orderId}`);
    return new Response(JSON.stringify({ success: false, message: 'No coordinates available', distanceKm: 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error logging delivery distance:', error);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
