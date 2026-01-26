import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FindRidersRequest {
  vendorId: string;
  vendorLat: number;
  vendorLon: number;
  maxRadiusKm?: number;
}

interface RiderWithDistance {
  id: string;
  user_id: string;
  distance: number;
  is_online: boolean;
  vehicle_type: string | null;
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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { vendorId, vendorLat, vendorLon, maxRadiusKm = 5 }: FindRidersRequest = await req.json();

    if (!vendorLat || !vendorLon) {
      return new Response(
        JSON.stringify({ error: 'Vendor location is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Finding riders near vendor ${vendorId} at ${vendorLat}, ${vendorLon}`);

    // Fetch online riders with location
    const { data: riders, error: ridersError } = await supabase
      .from('rider_profiles')
      .select('id, user_id, current_latitude, current_longitude, is_online, vehicle_type, affiliated_vendor_id')
      .eq('is_online', true)
      .eq('is_verified', true)
      .not('current_latitude', 'is', null)
      .not('current_longitude', 'is', null);

    if (ridersError) {
      console.error('Error fetching riders:', ridersError);
      throw ridersError;
    }

    if (!riders || riders.length === 0) {
      console.log('No online riders found');
      return new Response(
        JSON.stringify({ riders: [], message: 'No online riders available' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check vendor's delivery mode preference
    const { data: vendor } = await supabase
      .from('vendors')
      .select('delivery_mode, own_rider_priority')
      .eq('id', vendorId)
      .single();

    // Calculate distance and filter by radius
    const nearbyRiders: RiderWithDistance[] = riders
      .map(rider => ({
        id: rider.id,
        user_id: rider.user_id,
        distance: calculateDistance(
          vendorLat,
          vendorLon,
          rider.current_latitude!,
          rider.current_longitude!
        ),
        is_online: rider.is_online ?? false,
        vehicle_type: rider.vehicle_type,
        is_affiliated: rider.affiliated_vendor_id === vendorId,
      }))
      .filter(rider => rider.distance <= maxRadiusKm)
      .sort((a, b) => {
        // If vendor prioritizes own riders, sort them first
        if (vendor?.own_rider_priority) {
          if (a.is_affiliated && !b.is_affiliated) return -1;
          if (!a.is_affiliated && b.is_affiliated) return 1;
        }
        return a.distance - b.distance;
      });

    console.log(`Found ${nearbyRiders.length} nearby riders within ${maxRadiusKm}km`);

    return new Response(
      JSON.stringify({ 
        riders: nearbyRiders,
        count: nearbyRiders.length,
        searchRadiusKm: maxRadiusKm,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error finding nearby riders:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
