import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getGoogleMapsDistance, haversineDistance } from "../_shared/google-maps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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
        // Calculate actual distance for delivery fee — even for online outlets
        gmResult = await getGoogleMapsDistance(
          customer_lat, customer_lon, closestOutlet.latitude, closestOutlet.longitude
        );
        closestDistance = gmResult.distanceKm;
        console.log(`Vendor distance (${gmResult.source}): ${closestDistance} km`);
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
            is_open: closestOutlet.is_open,
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

    // Resolve customer state via reverse geocoding for online outlet matching
    let customerState: string | null = null;
    try {
      const googleKey = Deno.env.get("GOOGLE_MAPS_API_KEY");
      if (googleKey) {
        const geoRes = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${customer_lat},${customer_lon}&key=${googleKey}`
        );
        const geoData = await geoRes.json();
        console.log("Reverse geocode status:", geoData?.status, "results count:", geoData?.results?.length);
        // Search through all results for administrative_area_level_1
        for (const result of (geoData?.results || [])) {
          const stateComponent = result?.address_components?.find(
            (c: any) => c.types?.includes("administrative_area_level_1")
          );
          if (stateComponent) {
            customerState = stateComponent.long_name?.toLowerCase() || null;
            console.log("Found customer state:", customerState);
            break;
          }
        }
      }
    } catch (e) {
      console.log("Could not resolve customer state:", e);
    }

    console.log("Resolved customer state:", customerState);

    // Separate online outlets (state-matched, no distance limit) from physical outlets
    const onlineOutlets: any[] = [];
    const physicalOutlets: any[] = [];

    for (const outlet of filteredOutlets) {
      const storeType = outlet.store_type || 'physical';
      if (storeType === 'online' || storeType === 'both') {
        // Online outlets: match by state (case-insensitive)
        const outletState = (outlet.state || '').toLowerCase().replace(/\s*state\s*/i, '').trim();
        const normalizedCustomerState = (customerState || '').replace(/\s*state\s*/i, '').trim();
        
        console.log(`Online outlet "${outlet.outlet_name}" state="${outletState}" vs customer="${normalizedCustomerState}"`);
        
        const stateMatch = normalizedCustomerState && outletState && (
          outletState === normalizedCustomerState ||
          outletState.includes(normalizedCustomerState) ||
          normalizedCustomerState.includes(outletState)
        );
        
        if (stateMatch) {
          onlineOutlets.push(outlet);
        }
        // If store_type is 'both', also check distance for physical discovery
        if (storeType === 'both' && outlet.latitude && outlet.longitude) {
          physicalOutlets.push(outlet);
        }
      } else {
        physicalOutlets.push(outlet);
      }
    }

    // First pass: quick Haversine filter for physical candidates
    const candidates = physicalOutlets.filter((outlet: any) => {
      if (!outlet.latitude || !outlet.longitude) return false;
      const distance = haversineDistance(customer_lat, customer_lon, outlet.latitude, outlet.longitude);
      const outletRadius = outlet.sales_radius ?? maxVisibilityRadius;
      return distance <= outletRadius * 1.5;
    });

    // Second pass: get accurate Google Maps distances for physical candidates
    const nearbyVendors = [];
    const addedOutletIds = new Set<string>();

    for (const outlet of candidates) {
      const vendor = (outlet as any).vendors;
      const gmResult = await getGoogleMapsDistance(
        customer_lat, customer_lon, outlet.latitude, outlet.longitude
      );
      const distance = gmResult.distanceKm;
      const outletRadius = outlet.sales_radius ?? maxVisibilityRadius;

      if (distance > outletRadius) {
        console.log(`Outlet ${vendor?.name} – ${outlet.outlet_surname} excluded: ${distance}km (${gmResult.source}) > ${outletRadius}km`);
        continue;
      }

      // GPS drift compensation: treat distances under 500m as 0
      const effectiveDistance = distance < 0.5 ? 0 : distance;
      const dynamicDeliveryFee = effectiveDistance <= baseDeliveryDistanceKm
        ? baseDeliveryFee
        : Math.round(baseDeliveryFee + (effectiveDistance - baseDeliveryDistanceKm) * perKmFee);

      addedOutletIds.add(outlet.id);
      nearbyVendors.push({
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
        outlet_id: outlet.id,
        outlet_name: outlet.outlet_name,
        outlet_surname: outlet.outlet_surname,
        address: outlet.address,
        city: outlet.city,
        state: outlet.state,
        latitude: outlet.latitude,
        longitude: outlet.longitude,
        delivery_mode: outlet.delivery_mode,
        distance: distance,
        dynamic_delivery_fee: dynamicDeliveryFee,
        estimated_delivery_minutes: gmResult.durationMinutes,
        distance_source: gmResult.source,
        display_name: outlet.outlet_surname
          ? `${vendor.name} – ${outlet.outlet_surname}`
          : vendor.name,
        store_type: outlet.store_type,
        social_media_handles: outlet.social_media_handles,
      });
    }

    // Add online outlets (state-matched, no distance restriction)
    for (const outlet of onlineOutlets) {
      if (addedOutletIds.has(outlet.id)) continue;
      addedOutletIds.add(outlet.id);
      const vendor = (outlet as any).vendors;

      // Calculate actual distance for delivery fee if coords available
      let onlineDistance = 0;
      let onlineFee = baseDeliveryFee;
      let onlineEta: number | null = null;
      let onlineSource = 'online';

      if (outlet.latitude && outlet.longitude) {
        const onlineGm = await getGoogleMapsDistance(
          customer_lat, customer_lon, outlet.latitude, outlet.longitude
        );
        onlineDistance = onlineGm.distanceKm;
        onlineEta = onlineGm.durationMinutes;
        onlineSource = onlineGm.source;
        const effectiveOnlineDist = onlineDistance < 0.5 ? 0 : onlineDistance;
        onlineFee = effectiveOnlineDist <= baseDeliveryDistanceKm
          ? baseDeliveryFee
          : Math.round(baseDeliveryFee + (effectiveOnlineDist - baseDeliveryDistanceKm) * perKmFee);
      }

      nearbyVendors.push({
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
        outlet_id: outlet.id,
        outlet_name: outlet.outlet_name,
        outlet_surname: outlet.outlet_surname,
        address: outlet.address,
        city: outlet.city,
        state: outlet.state,
        latitude: outlet.latitude,
        longitude: outlet.longitude,
        delivery_mode: outlet.delivery_mode,
        distance: onlineDistance,
        dynamic_delivery_fee: onlineFee,
        estimated_delivery_minutes: onlineEta,
        distance_source: onlineSource,
        display_name: outlet.outlet_surname
          ? `${vendor.name} – ${outlet.outlet_surname}`
          : vendor.name,
        store_type: outlet.store_type,
        social_media_handles: outlet.social_media_handles,
      });
    }

    // Sort: open first, then by distance
    nearbyVendors.sort((a: any, b: any) => {
      if (a.is_open !== b.is_open) return a.is_open ? -1 : 1;
      return a.distance - b.distance;
    });

    console.log(`Found ${nearbyVendors.length} outlets within radius (Google Maps enhanced)`);

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
