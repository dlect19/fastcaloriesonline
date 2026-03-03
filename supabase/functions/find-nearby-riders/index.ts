import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { haversineDistance } from '../_shared/google-maps.ts';

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

// Use shared Haversine for rider proximity (fast, no API call needed for filtering)
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineDistance(lat1, lon1, lat2, lon2);
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

    // Fetch online riders with location and work preferences
    // Only include riders who have NIN and are fully verified
    const { data: riders, error: ridersError } = await supabase
      .from('rider_profiles')
      .select('id, user_id, current_latitude, current_longitude, is_online, vehicle_type, affiliated_vendor_id, preferred_latitude, preferred_longitude, preferred_city, preferred_state, work_radius_km, nin_number, nin_verified, is_email_verified')
      .eq('is_online', true)
      .eq('is_verified', true)
      .not('nin_number', 'is', null);

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

    // Calculate distance and filter by radius, considering both current location and work preferences
    const nearbyRiders: RiderWithDistance[] = riders
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
        
        const distanceFromVendor = calculateDistance(
          vendorLat,
          vendorLon,
          riderLat!,
          riderLon!
        );
        
        // Check if vendor is within rider's work radius (if set)
        const riderWorkRadius = rider.work_radius_km || maxRadiusKm;
        const withinWorkRadius = distanceFromVendor <= riderWorkRadius;
        
        return {
          id: rider.id,
          user_id: rider.user_id,
          distance: distanceFromVendor,
          is_online: rider.is_online ?? false,
          vehicle_type: rider.vehicle_type,
          is_affiliated: rider.affiliated_vendor_id === vendorId,
          within_work_radius: withinWorkRadius,
        };
      })
      .filter(rider => rider.distance <= maxRadiusKm && rider.within_work_radius)
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
