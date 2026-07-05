import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getGoogleMapsDistance } from '../_shared/google-maps.ts';

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

    if (request?.vendor_latitude && request?.vendor_longitude && request?.customer_latitude && request?.customer_longitude) {
      originLat = request.vendor_latitude;
      originLng = request.vendor_longitude;
      destLat = request.customer_latitude;
      destLng = request.customer_longitude;
    }

    // Step 2: Fallback to order's address vs vendor
    if (!originLat) {
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

    // Step 2b: Final fallback — vendor coords vs rider's current location (for carryout
    // or orders that never captured a customer address, e.g. WhatsApp/POS)
    if (!originLat || !destLat) {
      const { data: order } = await supabase
        .from('orders')
        .select('vendor_id')
        .eq('id', orderId)
        .maybeSingle();
      const [{ data: vendor }, { data: rider }] = await Promise.all([
        order?.vendor_id
          ? supabase.from('vendors').select('latitude, longitude').eq('id', order.vendor_id).maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('rider_profiles').select('current_latitude, current_longitude').eq('user_id', riderId).maybeSingle(),
      ]);
      if (vendor?.latitude && vendor?.longitude && rider?.current_latitude && rider?.current_longitude) {
        originLat = vendor.latitude;
        originLng = vendor.longitude;
        destLat = rider.current_latitude;
        destLng = rider.current_longitude;
        console.log(`Using rider's current location as delivery destination for order ${orderId}`);
      }
    }

    // Step 3: Calculate distance using shared Google Maps helper (direct, no edge-to-edge call)
    if (!distanceKm && originLat && originLng && destLat && destLng) {
      const result = await getGoogleMapsDistance(originLat, originLng, destLat, destLng);
      distanceKm = result.distanceKm;
      console.log(`Distance for order ${orderId}: ${distanceKm} km via ${result.source}`);
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
