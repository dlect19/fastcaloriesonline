import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function calculateHaversineDistance(
  lat1: number, lon1: number, lat2: number, lon2: number
): number {
  const R = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRadians(degrees: number): number {
  return degrees * (Math.PI / 180);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { customer_lat, customer_lon, category, vendor_id, outlet_id } = await req.json();

    console.log("get-nearby-vendors called with:", { customer_lat, customer_lon, category, vendor_id });

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

    // Fetch platform settings
    const { data: settingsData } = await supabase
      .from("platform_settings")
      .select("key, value")
      .in("key", ["vendor_delivery_radius_km", "base_delivery_fee", "base_delivery_distance_km", "per_km_fee"]);

    const settings: Record<string, string> = {};
    settingsData?.forEach((s: any) => { settings[s.key] = s.value; });

    const maxVisibilityRadius = parseFloat(settings["vendor_delivery_radius_km"]) || 10;
    const baseDeliveryFee = parseFloat(settings["base_delivery_fee"]) || 500;
    const baseDeliveryDistanceKm = parseFloat(settings["base_delivery_distance_km"]) || 3;
    const perKmFee = parseFloat(settings["per_km_fee"]) || 100;

    console.log("Settings:", { maxVisibilityRadius, baseDeliveryFee, baseDeliveryDistanceKm, perKmFee });

    // --- Single vendor access check (for direct vendor page access) ---
    if (vendor_id) {
      const { data: vendor, error: vendorError } = await supabase
        .from("vendors")
        .select("*")
        .eq("id", vendor_id)
        .eq("is_active", true)
        .single();

      if (vendorError || !vendor) {
        return new Response(
          JSON.stringify({ success: false, error: "vendor_not_found", message: "Vendor not found or not active", vendor: null }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Find approved outlet(s) for this vendor
      let outletQuery = supabase
        .from("vendor_outlets")
        .select("*")
        .eq("vendor_id", vendor_id)
        .eq("is_approved", true)
        .eq("is_active", true);

      // If a specific outlet was requested, filter to just that one
      if (outlet_id) {
        outletQuery = outletQuery.eq("id", outlet_id);
      }

      const { data: outlets } = await outletQuery;

      if (!outlets || outlets.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: "no_active_outlets", message: "This vendor has no active outlets.", vendor: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Find closest outlet with coordinates
      let closestOutlet = null;
      let closestDistance = Infinity;

      for (const outlet of outlets) {
        if (!outlet.latitude || !outlet.longitude) continue;
        const dist = calculateHaversineDistance(customer_lat, customer_lon, outlet.latitude, outlet.longitude);
        if (dist < closestDistance) {
          closestDistance = dist;
          closestOutlet = outlet;
        }
      }

      if (!closestOutlet) {
        return new Response(
          JSON.stringify({ success: false, error: "vendor_location_unavailable", message: "This vendor's location is not configured.", vendor: null }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const outletRadius = closestOutlet.sales_radius ?? maxVisibilityRadius;

      if (closestDistance > outletRadius) {
        return new Response(
          JSON.stringify({
            success: false, error: "vendor_outside_radius",
            message: `This vendor is not available in your area. They are ${closestDistance.toFixed(1)}km away, but their delivery radius is ${outletRadius}km.`,
            vendor: null, distance: closestDistance, max_radius: outletRadius,
          }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const dynamicDeliveryFee = closestDistance <= baseDeliveryDistanceKm
        ? baseDeliveryFee
        : Math.round(baseDeliveryFee + (closestDistance - baseDeliveryDistanceKm) * perKmFee);

      return new Response(
        JSON.stringify({
          success: true,
          vendor: {
            ...vendor,
            outlet_id: closestOutlet.id,
            outlet_name: closestOutlet.outlet_name,
            outlet_surname: closestOutlet.outlet_surname,
            outlet_address: closestOutlet.address,
            outlet_city: closestOutlet.city,
            outlet_state: closestOutlet.state,
            is_open: closestOutlet.is_open,
            distance: Math.round(closestDistance * 10) / 10,
            dynamic_delivery_fee: dynamicDeliveryFee,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Discovery: fetch all active outlets joined with vendors ---
    const { data: outlets, error: outletsError } = await supabase
      .from("vendor_outlets")
      .select("*, vendors!inner(id, name, description, logo_url, banner_url, category, rating, total_ratings, is_active, is_open, phone, email, slug)")
      .eq("is_approved", true)
      .eq("is_active", true)
      .eq("vendors.is_active", true);

    if (outletsError) {
      console.error("Error fetching outlets:", outletsError);
      return new Response(
        JSON.stringify({ success: false, error: "database_error", message: "Failed to fetch vendors", vendors: [] }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Optionally filter by category
    let filteredOutlets = outlets || [];
    if (category && category !== "all" && ["restaurant", "pharmacy", "market"].includes(category)) {
      filteredOutlets = filteredOutlets.filter((o: any) => o.vendors?.category === category);
    }

    // Filter by distance using per-outlet sales_radius
    const nearbyVendors = filteredOutlets
      .filter((outlet: any) => {
        if (!outlet.latitude || !outlet.longitude) {
          console.log(`Outlet ${outlet.vendors?.name} – ${outlet.outlet_surname} excluded: no coordinates`);
          return false;
        }
        const distance = calculateHaversineDistance(customer_lat, customer_lon, outlet.latitude, outlet.longitude);
        const outletRadius = outlet.sales_radius ?? maxVisibilityRadius;
        const withinRadius = distance <= outletRadius;
        if (!withinRadius) {
          console.log(`Outlet ${outlet.vendors?.name} – ${outlet.outlet_surname} excluded: ${distance.toFixed(2)}km > ${outletRadius}km`);
        }
        return withinRadius;
      })
      .map((outlet: any) => {
        const vendor = outlet.vendors;
        const distance = calculateHaversineDistance(customer_lat, customer_lon, outlet.latitude, outlet.longitude);
        const dynamicDeliveryFee = distance <= baseDeliveryDistanceKm
          ? baseDeliveryFee
          : Math.round(baseDeliveryFee + (distance - baseDeliveryDistanceKm) * perKmFee);

        return {
          // Vendor-level fields (for backward compatibility)
          id: vendor.id,
          name: vendor.name,
          description: vendor.description,
          logo_url: vendor.logo_url,
          banner_url: vendor.banner_url,
          category: vendor.category,
          rating: outlet.rating ?? vendor.rating,
          total_ratings: outlet.total_ratings ?? vendor.total_ratings,
          is_active: true,
          is_open: outlet.is_open,
          phone: vendor.phone,
          email: vendor.email,
          slug: vendor.slug,
          // Outlet-specific fields
          outlet_id: outlet.id,
          outlet_name: outlet.outlet_name,
          outlet_surname: outlet.outlet_surname,
          address: outlet.address,
          city: outlet.city,
          state: outlet.state,
          latitude: outlet.latitude,
          longitude: outlet.longitude,
          delivery_mode: outlet.delivery_mode,
          // Computed fields
          distance: Math.round(distance * 10) / 10,
          dynamic_delivery_fee: dynamicDeliveryFee,
          // Display name for customer UI
          display_name: outlet.outlet_surname
            ? `${vendor.name} – ${outlet.outlet_surname}`
            : vendor.name,
        };
      })
      .sort((a: any, b: any) => {
        if (a.is_open !== b.is_open) return a.is_open ? -1 : 1;
        return a.distance - b.distance;
      });

    console.log(`Found ${nearbyVendors.length} outlets within radius`);

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
