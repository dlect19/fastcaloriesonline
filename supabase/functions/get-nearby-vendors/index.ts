import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleMapsDistance, haversineDistance } from "../_shared/google-maps.ts";
import { selectBrowseOutlets } from "../_shared/google-usage-core.ts";
import { logGoogleUsage, platformEnvironment } from "../_shared/google-usage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Ray-casting point-in-polygon algorithm
function pointInPolygon(lat: number, lng: number, polygon: { lat: number; lng: number }[]): boolean {
  if (!polygon || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].lat, yi = polygon[i].lng;
    const xj = polygon[j].lat, yj = polygon[j].lng;
    const intersect = ((yi > lng) !== (yj > lng)) && (lat < (xj - xi) * (lng - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { customer_lat, customer_lon, category, vendor_id, outlet_id, customer_state } = await req.json();

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
      .in("key", ["vendor_delivery_radius_km", "base_delivery_fee", "base_delivery_distance_km", "per_km_fee", "coverage_area_enforcement"]);

    const settings: Record<string, string> = {};
    settingsData?.forEach((s: any) => { settings[s.key] = s.value; });

    const maxVisibilityRadius = parseFloat(settings["vendor_delivery_radius_km"]) || 10;
    const baseDeliveryFee = parseFloat(settings["base_delivery_fee"]) || 500;
    const baseDeliveryDistanceKm = parseFloat(settings["base_delivery_distance_km"]) || 3;
    const perKmFee = parseFloat(settings["per_km_fee"]) || 100;
    const enforceCoverage = settings["coverage_area_enforcement"] === "true";

    // Fetch active coverage areas
    const { data: coverageAreas } = await supabase
      .from("coverage_areas")
      .select("id, name, polygon, color")
      .eq("is_active", true);

    const activeCoverageAreas = (coverageAreas || []).map((a: any) => ({
      ...a,
      polygon: Array.isArray(a.polygon) ? a.polygon : [],
    }));

    // Check if customer is inside any coverage area
    const customerInCoverage = activeCoverageAreas.length === 0 || activeCoverageAreas.some(
      (area: any) => pointInPolygon(customer_lat, customer_lon, area.polygon)
    );

    // If coverage enforcement is on and customer is outside all zones, return empty
    if (enforceCoverage && !customerInCoverage && activeCoverageAreas.length > 0) {
      return new Response(
        JSON.stringify({
          success: true,
          vendors: [],
          total_count: 0,
          max_radius_km: maxVisibilityRadius,
          customer_location: { lat: customer_lat, lon: customer_lon },
          coverage_areas: activeCoverageAreas,
          customer_in_coverage: false,
          message: "Your location is outside our current delivery coverage areas.",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

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

      // Find closest outlet — use Haversine for quick filtering first
      let closestOutlet = null;
      let closestDistance = Infinity;
      const isOnlineOutlet = (o: any) => o.store_type === 'online' || o.store_type === 'both';

      for (const outlet of outlets) {
        if (!outlet.latitude || !outlet.longitude) {
          // Online outlet without coords — still selectable but can't calc distance
          if (isOnlineOutlet(outlet) && !closestOutlet) {
            closestOutlet = outlet;
            closestDistance = Infinity;
          }
          continue;
        }
        const dist = haversineDistance(customer_lat, customer_lon, outlet.latitude, outlet.longitude);
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

      const outletIsOnline = isOnlineOutlet(closestOutlet);
      let gmResult = { distanceKm: 0, durationMinutes: null as number | null, source: 'none' };

      if (closestOutlet.latitude && closestOutlet.longitude) {
        // Calculate actual distance for delivery fee — vendor→customer direction (delivery route)
        gmResult = await getGoogleMapsDistance(
          closestOutlet.latitude, closestOutlet.longitude, customer_lat, customer_lon,
          "get-nearby-vendors:vendor-open",
        );
        closestDistance = gmResult.distanceKm;
        console.log(`Vendor distance (${gmResult.source}): ${closestDistance} km (vendor→customer)`);
      }

      // Only enforce radius restriction for physical outlets
      if (!outletIsOnline) {
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
      }

      // GPS drift compensation: treat distances under 500m as 0
      const effectiveDistance = closestDistance < 0.5 ? 0 : closestDistance;
      const dynamicDeliveryFee = effectiveDistance <= baseDeliveryDistanceKm
        ? baseDeliveryFee
        : Math.round(baseDeliveryFee + (effectiveDistance - baseDeliveryDistanceKm) * perKmFee);

      const outletDisplayName = closestOutlet.outlet_surname
        ? `${vendor.name} – ${closestOutlet.outlet_surname}`
        : (closestOutlet.outlet_name || vendor.name);

      return new Response(
        JSON.stringify({
          success: true,
          vendor: {
            ...vendor,
            name: outletDisplayName,
            rating: closestOutlet.rating ?? vendor.rating,
            total_ratings: closestOutlet.total_ratings ?? vendor.total_ratings,
            is_open: (closestOutlet.admin_force_closed || (vendor as any).admin_force_closed) ? false : closestOutlet.is_open,
            admin_force_closed: !!(closestOutlet.admin_force_closed || (vendor as any).admin_force_closed),
            address: closestOutlet.address ?? vendor.address,
            city: closestOutlet.city ?? vendor.city,
            state: closestOutlet.state ?? vendor.state,
            latitude: closestOutlet.latitude ?? vendor.latitude,
            longitude: closestOutlet.longitude ?? vendor.longitude,
            delivery_mode: closestOutlet.delivery_mode ?? vendor.delivery_mode,
            delivery_fee: dynamicDeliveryFee,
            outlet_id: closestOutlet.id,
            outlet_name: closestOutlet.outlet_name,
            outlet_surname: closestOutlet.outlet_surname,
            outlet_address: closestOutlet.address,
            outlet_city: closestOutlet.city,
            outlet_state: closestOutlet.state,
            distance: closestDistance,
            dynamic_delivery_fee: dynamicDeliveryFee,
            display_name: outletDisplayName,
            estimated_delivery_minutes: gmResult.durationMinutes,
            distance_source: gmResult.source,
            store_type: closestOutlet.store_type,
            social_media_handles: closestOutlet.social_media_handles,
          },
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // --- Discovery: fetch all active outlets joined with vendors ---
    const { data: outlets, error: outletsError } = await supabase
      .from("vendor_outlets")
      .select("*, vendors!inner(id, name, description, logo_url, banner_url, category, rating, total_ratings, is_active, is_open, admin_force_closed, phone, email, slug)")
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

    // Use customer_state from the delivery address if provided (more reliable than GPS reverse-geocode)
    // Only reverse-geocode from GPS coordinates as a fallback
    let customerState: string | null = customer_state ? customer_state.toLowerCase() : null;
    
    if (!customerState) {
      try {
        const googleKey = Deno.env.get("GOOGLE_MAPS_KEY");
        if (googleKey) {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort("reverse_geocode_timeout"), 4000);

          try {
            const geoRes = await fetch(
              `https://maps.googleapis.com/maps/api/geocode/json?latlng=${customer_lat},${customer_lon}&key=${googleKey}`,
              { signal: controller.signal }
            );

            if (geoRes.ok) {
              const geoData = await geoRes.json();
              console.log("Reverse geocode status:", geoData?.status, "results count:", geoData?.results?.length);
              logGoogleUsage({
                provider: 'google_maps', endpoint: 'reverse_geocode', api: 'reverse_geocode',
                function_name: 'get-nearby-vendors', environment: await platformEnvironment(supabase),
                outcome: geoData?.status === 'OK' ? 'success' : 'failed', status_code: geoRes.status,
                billable_elements: 1, cache_status: 'none',
              }, supabase);
              for (const result of (geoData?.results || [])) {
                const stateComponent = result?.address_components?.find(
                  (c: any) => c.types?.includes("administrative_area_level_1")
                );
                if (stateComponent) {
                  customerState = stateComponent.long_name?.toLowerCase() || null;
                  console.log("Found customer state from GPS:", customerState);
                  break;
                }
              }
            } else {
              console.log("Reverse geocode HTTP error:", geoRes.status);
            }
          } finally {
            clearTimeout(timeout);
          }
        }
      } catch (e) {
        console.log("Could not resolve customer state:", e);
      }
    } else {
      console.log("Using customer state from delivery address:", customerState);
    }

    console.log("Resolved customer state:", customerState);

    // Browse list: straight-line distance only. ZERO Google Distance Matrix
    // calls. Each outlet appears once (physical-in-radius, else state-matched
    // online). Road distance is computed only when a customer opens a store
    // or requests a delivery quote.
    const selected = selectBrowseOutlets(
      filteredOutlets as any[],
      { lat: customer_lat, lng: customer_lon, state: customerState },
      maxVisibilityRadius,
    );
    const nearbyVendors: any[] = [];
    for (const { outlet, distanceKm, kind } of selected) {
      const vendor = (outlet as any).vendors;
      if (!vendor) continue;
      const effective = distanceKm < 0.5 ? 0 : distanceKm;
      const fee = effective <= baseDeliveryDistanceKm
        ? baseDeliveryFee
        : Math.round(baseDeliveryFee + (effective - baseDeliveryDistanceKm) * perKmFee);
      nearbyVendors.push({
        id: vendor.id,
        name: vendor.name,
        description: vendor.description,
        logo_url: vendor.logo_url,
        banner_url: vendor.banner_url,
        category: vendor.category,
        rating: (outlet as any).rating ?? vendor.rating,
        total_ratings: (outlet as any).total_ratings ?? vendor.total_ratings,
        is_active: true,
        is_open: ((outlet as any).admin_force_closed || vendor.admin_force_closed) ? false : (outlet as any).is_open,
        admin_force_closed: !!((outlet as any).admin_force_closed || vendor.admin_force_closed),
        phone: vendor.phone,
        email: vendor.email,
        slug: vendor.slug,
        outlet_id: outlet.id,
        outlet_name: (outlet as any).outlet_name,
        outlet_surname: (outlet as any).outlet_surname,
        address: (outlet as any).address,
        city: (outlet as any).city,
        state: (outlet as any).state,
        latitude: outlet.latitude,
        longitude: outlet.longitude,
        delivery_mode: (outlet as any).delivery_mode,
        distance: distanceKm,
        dynamic_delivery_fee: fee,
        estimated_delivery_minutes: Math.round((distanceKm / 25) * 60),
        distance_source: kind === "online" ? "online_estimate" : "straight_line_estimate",
        distance_is_estimate: true,
        fee_is_estimate: true,
        display_name: (outlet as any).outlet_surname
          ? `${vendor.name} – ${(outlet as any).outlet_surname}`
          : vendor.name,
        store_type: (outlet as any).store_type,
        social_media_handles: (outlet as any).social_media_handles,
      });
    }

    // Sort: open first, then by distance
    nearbyVendors.sort((a: any, b: any) => {
      if (a.is_open !== b.is_open) return a.is_open ? -1 : 1;
      return a.distance - b.distance;
    });

    console.log(`Found ${nearbyVendors.length} outlets within radius (straight-line, no Distance Matrix)`);

    return new Response(
      JSON.stringify({
        success: true,
        vendors: nearbyVendors,
        total_count: nearbyVendors.length,
        max_radius_km: maxVisibilityRadius,
        customer_location: { lat: customer_lat, lon: customer_lon },
        coverage_areas: activeCoverageAreas,
        customer_in_coverage: customerInCoverage,
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
