import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/**
 * Calculate distance between two points using the Haversine formula
 * @returns Distance in kilometers
 */
function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
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

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

    const { customer_lat, customer_lon, category, vendor_id } = await req.json();

    console.log("get-nearby-vendors called with:", { customer_lat, customer_lon, category, vendor_id });

    // Validate required location data
    if (customer_lat === null || customer_lat === undefined || 
        customer_lon === null || customer_lon === undefined) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "customer_location_required",
          message: "Customer location (latitude and longitude) is required to discover vendors",
          vendors: [],
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch platform settings for visibility radius
    const { data: settingsData } = await supabase
      .from("platform_settings")
      .select("key, value")
      .in("key", ["vendor_delivery_radius_km", "base_delivery_fee", "base_delivery_distance_km", "per_km_fee"]);

    const settings: Record<string, string> = {};
    settingsData?.forEach((s) => {
      settings[s.key] = s.value;
    });

    const maxVisibilityRadius = parseFloat(settings["vendor_delivery_radius_km"]) || 10;
    const baseDeliveryFee = parseFloat(settings["base_delivery_fee"]) || 500;
    const baseDeliveryDistanceKm = parseFloat(settings["base_delivery_distance_km"]) || 3;
    const perKmFee = parseFloat(settings["per_km_fee"]) || 100;

    console.log("Settings:", { maxVisibilityRadius, baseDeliveryFee, baseDeliveryDistanceKm, perKmFee });

    // If checking a specific vendor (for direct access validation)
    if (vendor_id) {
      const { data: vendor, error: vendorError } = await supabase
        .from("vendors")
        .select("*")
        .eq("id", vendor_id)
        .eq("is_active", true)
        .single();

      if (vendorError || !vendor) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "vendor_not_found",
            message: "Vendor not found or not active",
            vendor: null,
          }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check if vendor has coordinates
      if (!vendor.latitude || !vendor.longitude) {
        // Vendor without coordinates - cannot determine distance, deny access
        return new Response(
          JSON.stringify({
            success: false,
            error: "vendor_location_unavailable",
            message: "This vendor's location is not configured. Please try again later.",
            vendor: null,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Calculate distance
      const distance = calculateHaversineDistance(
        customer_lat,
        customer_lon,
        vendor.latitude,
        vendor.longitude
      );

      console.log(`Vendor ${vendor.name} distance: ${distance.toFixed(2)} km (max: ${maxVisibilityRadius} km)`);

      // Check if within radius
      if (distance > maxVisibilityRadius) {
        return new Response(
          JSON.stringify({
            success: false,
            error: "vendor_outside_radius",
            message: `This vendor is not available in your area. They are ${distance.toFixed(1)}km away, but our delivery radius is ${maxVisibilityRadius}km.`,
            vendor: null,
            distance: distance,
            max_radius: maxVisibilityRadius,
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Calculate dynamic delivery fee
      const dynamicDeliveryFee =
        distance <= baseDeliveryDistanceKm
          ? baseDeliveryFee
          : Math.round(baseDeliveryFee + (distance - baseDeliveryDistanceKm) * perKmFee);

      return new Response(
        JSON.stringify({
          success: true,
          vendor: {
            ...vendor,
            distance: Math.round(distance * 10) / 10,
            dynamic_delivery_fee: dynamicDeliveryFee,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Fetch all active vendors for discovery
    let query = supabase
      .from("vendors")
      .select("*")
      .eq("is_active", true)
      .order("rating", { ascending: false });

    if (category && category !== "all" && ["restaurant", "pharmacy", "market"].includes(category)) {
      query = query.eq("category", category);
    }

    const { data: vendors, error: vendorsError } = await query;

    if (vendorsError) {
      console.error("Error fetching vendors:", vendorsError);
      return new Response(
        JSON.stringify({
          success: false,
          error: "database_error",
          message: "Failed to fetch vendors",
          vendors: [],
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Filter vendors by distance (backend enforcement)
    const nearbyVendors = (vendors || [])
      .filter((vendor) => {
        // Vendors must have coordinates to be visible
        if (!vendor.latitude || !vendor.longitude) {
          console.log(`Vendor ${vendor.name} excluded: no coordinates`);
          return false;
        }
        
        const distance = calculateHaversineDistance(
          customer_lat,
          customer_lon,
          vendor.latitude,
          vendor.longitude
        );
        
        const withinRadius = distance <= maxVisibilityRadius;
        if (!withinRadius) {
          console.log(`Vendor ${vendor.name} excluded: ${distance.toFixed(2)}km > ${maxVisibilityRadius}km`);
        }
        
        return withinRadius;
      })
      .map((vendor) => {
        const distance = calculateHaversineDistance(
          customer_lat,
          customer_lon,
          vendor.latitude!,
          vendor.longitude!
        );

        // Calculate dynamic delivery fee
        const dynamicDeliveryFee =
          distance <= baseDeliveryDistanceKm
            ? baseDeliveryFee
            : Math.round(baseDeliveryFee + (distance - baseDeliveryDistanceKm) * perKmFee);

        return {
          ...vendor,
          distance: Math.round(distance * 10) / 10,
          dynamic_delivery_fee: dynamicDeliveryFee,
        };
      })
      .sort((a, b) => {
        // Sort: open vendors first, then by distance
        if (a.is_active !== b.is_active) {
          return a.is_active ? -1 : 1;
        }
        return a.distance - b.distance;
      });

    console.log(`Found ${nearbyVendors.length} vendors within ${maxVisibilityRadius}km radius`);

    return new Response(
      JSON.stringify({
        success: true,
        vendors: nearbyVendors,
        total_count: nearbyVendors.length,
        max_radius_km: maxVisibilityRadius,
        customer_location: { lat: customer_lat, lon: customer_lon },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in get-nearby-vendors:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: "internal_error",
        message: error instanceof Error ? error.message : "Unknown error",
        vendors: [],
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
