import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getGoogleMapsDistance, haversineDistance } from '../_shared/google-maps.ts';
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface DispatchOrderRequest {
  orderId: string;
  publicOnly?: boolean;
}

interface EligibleRider {
  id: string;
  user_id: string;
  distance_km: number;
  priority_tier: 'vendor_riders' | 'delivery_company_riders' | 'platform_riders';
  current_latitude: number | null;
  current_longitude: number | null;
  preferred_latitude: number | null;
  preferred_longitude: number | null;
}

interface PayoutSettings {
  platformFeePct: number;
  platformFeeMin: number;
  platformFeeMax: number;
  
  distanceBonusThresholdKm: number;
  distanceBonusRate: number;
  surgeEnabled: boolean;
  timeSurgeEnabled: boolean;
  weatherSurgeEnabled: boolean;
  maxSurgeCap: number;
  morningStartHour: number;
  morningEndHour: number;
  afternoonStartHour: number;
  afternoonEndHour: number;
  nightStartHour: number;
  nightEndHour: number;
  timeSurgeMorning: number;
  timeSurgeAfternoon: number;
  timeSurgeNight: number;
  weatherSurgeClear: number;
  weatherSurgeRain: number;
  weatherSurgeStorm: number;
  detectedWeather: string; // auto-detected from Open-Meteo
}

interface PayoutBreakdown {
  deliveryFee: number;
  platformFee: number;
  distanceBonus: number;
  timeSurgeBonus: number;
  weatherSurgeBonus: number;
  totalSurgeBonus: number;
  rawRiderPay: number;
  subsidyAmount: number;
  finalRiderPay: number;
  weatherCondition: string;
  timePeriod: string;
}

// Use shared haversineDistance for quick rider proximity filtering
// Google Maps is used for the final delivery distance calculation
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineDistance(lat1, lon1, lat2, lon2);
}

/**
 * Fetch real-time weather from Open-Meteo (free, no API key).
 * Returns 'clear' | 'rain' | 'storm' based on WMO weather codes.
 */
async function fetchWeatherCondition(lat: number, lon: number): Promise<string> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current_weather=true`;
    const res = await fetch(url);
    if (!res.ok) return 'clear';
    const data = await res.json();
    const code = data?.current_weather?.weathercode ?? 0;
    // WMO codes: 0-3 = clear/cloudy, 51-67 = drizzle/rain, 71-77 = snow, 80-82 = showers, 95-99 = thunderstorm
    if (code >= 95) return 'storm';
    if (code >= 51) return 'rain';
    return 'clear';
  } catch {
    return 'clear';
  }
}

async function getDispatchSettings(supabase: any) {
  const { data } = await supabase
    .from('platform_settings')
    .select('key, value');

  const settings: Record<string, string> = {};
  data?.forEach((s: any) => { settings[s.key] = s.value; });

  return {
    acceptanceTimeoutSeconds: parseInt(settings.dispatch_acceptance_timeout_seconds || '60'),
    initialRadiusKm: parseFloat(settings.dispatch_initial_radius_km || '5'),
    maxRetries: parseInt(settings.dispatch_max_retries || '3'),
    enablePriorityTiers: settings.dispatch_enable_priority_tiers !== 'false',
    tierTimeoutSeconds: parseInt(settings.dispatch_priority_tier_timeout_seconds || '30'),
  };
}

function getPayoutSettings(settings: Record<string, string>, detectedWeather: string = 'clear'): PayoutSettings {
  return {
    platformFeePct: parseFloat(settings.rider_platform_fee_pct || '20'),
    platformFeeMin: parseFloat(settings.rider_platform_fee_min || '300'),
    platformFeeMax: parseFloat(settings.rider_platform_fee_max || '700'),
    distanceBonusThresholdKm: parseFloat(settings.rider_distance_bonus_threshold_km || '4'),
    distanceBonusRate: parseFloat(settings.rider_distance_bonus_rate || '100'),
    surgeEnabled: settings.rider_surge_enabled !== 'false',
    timeSurgeEnabled: settings.rider_time_surge_enabled !== 'false',
    weatherSurgeEnabled: settings.rider_weather_surge_enabled !== 'false',
    maxSurgeCap: parseFloat(settings.rider_max_surge_cap || '500'),
    morningStartHour: parseInt(settings.rider_morning_start_hour || '6'),
    morningEndHour: parseInt(settings.rider_morning_end_hour || '12'),
    afternoonStartHour: parseInt(settings.rider_afternoon_start_hour || '12'),
    afternoonEndHour: parseInt(settings.rider_afternoon_end_hour || '18'),
    nightStartHour: parseInt(settings.rider_night_start_hour || '18'),
    nightEndHour: parseInt(settings.rider_night_end_hour || '24'),
    timeSurgeMorning: parseFloat(settings.rider_time_surge_morning || '0'),
    timeSurgeAfternoon: parseFloat(settings.rider_time_surge_afternoon || '100'),
    timeSurgeNight: parseFloat(settings.rider_time_surge_night || '200'),
    weatherSurgeClear: parseFloat(settings.rider_weather_surge_clear || '0'),
    weatherSurgeRain: parseFloat(settings.rider_weather_surge_rain || '100'),
    weatherSurgeStorm: parseFloat(settings.rider_weather_surge_storm || '300'),
    detectedWeather,
  };
}

function getTimePeriod(ps: PayoutSettings): string {
  const now = new Date();
  const hour = now.getHours();
  if (hour >= ps.morningStartHour && hour < ps.morningEndHour) return 'morning';
  if (hour >= ps.afternoonStartHour && hour < ps.afternoonEndHour) return 'afternoon';
  if (hour >= ps.nightStartHour || hour < ps.morningStartHour) return 'night';
  return 'morning';
}

function calculateRiderPayout(
  deliveryFee: number,
  deliveryDistanceKm: number,
  ps: PayoutSettings
): PayoutBreakdown {
  // NOTE: Surge is now included in the delivery_fee paid by the customer.
  // We calculate surge amounts here only for DISPLAY in the offer breakdown,
  // but do NOT add them on top — they're already in the fee.

  // 1. Determine surge amounts (for transparency/display only)
  const timePeriod = getTimePeriod(ps);
  let timeSurgeBonus = 0;
  if (ps.surgeEnabled && ps.timeSurgeEnabled) {
    if (timePeriod === 'morning') timeSurgeBonus = ps.timeSurgeMorning;
    else if (timePeriod === 'afternoon') timeSurgeBonus = ps.timeSurgeAfternoon;
    else if (timePeriod === 'night') timeSurgeBonus = ps.timeSurgeNight;
  }

  const weatherCondition = ps.detectedWeather || 'clear';
  let weatherSurgeBonus = 0;
  if (ps.surgeEnabled && ps.weatherSurgeEnabled) {
    if (weatherCondition === 'rain') weatherSurgeBonus = ps.weatherSurgeRain;
    else if (weatherCondition === 'storm') weatherSurgeBonus = ps.weatherSurgeStorm;
    else weatherSurgeBonus = ps.weatherSurgeClear;
  }

  const totalSurgeBonus = Math.min(timeSurgeBonus + weatherSurgeBonus, ps.maxSurgeCap);

  // 2. Platform fee is calculated on BASE fee (deliveryFee minus surge)
  const baseFee = Math.max(0, deliveryFee - totalSurgeBonus);
  const platformFee = Math.round(
    Math.min(
      Math.max(baseFee * (ps.platformFeePct / 100), ps.platformFeeMin),
      ps.platformFeeMax
    )
  );

  // 3. Distance bonus: extra km beyond threshold * rate
  const distanceBonus = Math.round(
    Math.max(0, (deliveryDistanceKm - ps.distanceBonusThresholdKm) * ps.distanceBonusRate)
  );

  // 4. Raw rider pay = totalDeliveryFee - platformFee + distanceBonus
  // Surge is already in deliveryFee, so rider naturally gets it (minus platform cut on base)
  const rawRiderPay = deliveryFee - platformFee + distanceBonus;

  // 5. Final rider pay = raw pay (no minimum guarantee / subsidy)
  const finalRiderPay = rawRiderPay;
  const subsidyAmount = 0;

  return {
    deliveryFee,
    platformFee: Math.min(platformFee, deliveryFee), // platform fee can't exceed delivery fee
    distanceBonus,
    timeSurgeBonus: ps.surgeEnabled && ps.timeSurgeEnabled ? timeSurgeBonus : 0,
    weatherSurgeBonus: ps.surgeEnabled && ps.weatherSurgeEnabled ? weatherSurgeBonus : 0,
    totalSurgeBonus,
    rawRiderPay,
    subsidyAmount,
    finalRiderPay,
    weatherCondition,
    timePeriod,
  };
}

interface VehicleTypeConfig {
  maxDeliveryDistanceKm: number;
  dispatchRadiusKm: number | null;
}

async function getVehicleTypeConfigs(supabase: any): Promise<Record<string, VehicleTypeConfig>> {
  const { data } = await supabase
    .from('vehicle_type_configs')
    .select('vehicle_type, max_delivery_distance_km, dispatch_radius_km')
    .eq('is_active', true);

  const configs: Record<string, VehicleTypeConfig> = {};
  (data || []).forEach((c: any) => {
    configs[c.vehicle_type] = {
      maxDeliveryDistanceKm: c.max_delivery_distance_km,
      dispatchRadiusKm: c.dispatch_radius_km,
    };
  });
  return configs;
}

async function getRiderActiveOrderCount(supabase: any, riderUserId: string): Promise<number> {
  const { count, error } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('rider_id', riderUserId)
    .in('status', ['assigned', 'picked_up', 'preparing', 'confirmed', 'searching_for_rider']);

  if (error) {
    console.error('Error counting rider active orders:', error);
    return 0;
  }
  return count || 0;
}

async function findEligibleRiders(
  supabase: any,
  vendorId: string,
  vendorLat: number,
  vendorLon: number,
  radiusKm: number,
  priorityTier: string,
  deliveryDistanceKm: number,
  maxConcurrentOrders: number
): Promise<EligibleRider[]> {
  console.log(`Finding ${priorityTier} riders within ${radiusKm}km of vendor (delivery distance: ${deliveryDistanceKm.toFixed(1)}km, maxConcurrent: ${maxConcurrentOrders})`);

  // Fetch vehicle type configs for distance enforcement
  const vehicleMaxDistances = await getVehicleTypeConfigs(supabase);

  const { data: vendorRiders } = await supabase
    .from('vendor_riders')
    .select('rider_profile_id')
    .eq('vendor_id', vendorId)
    .eq('is_active', true);

  const vendorRiderProfileIds = (vendorRiders || []).map((vr: any) => vr.rider_profile_id);

  const { data: riders, error } = await supabase
    .from('rider_profiles')
    .select('id, user_id, current_latitude, current_longitude, preferred_latitude, preferred_longitude, work_radius_km, affiliated_vendor_id, delivery_company_id, nin_verified, vehicle_type')
    .eq('is_online', true)
    .eq('is_verified', true)
    .eq('is_email_verified', true)
    .eq('nin_verified', true);

  if (error || !riders) {
    console.error('Error fetching riders:', error);
    return [];
  }

  const eligibleRiders: EligibleRider[] = [];
  let skippedVehicle = 0;
  let skippedCapacity = 0;

  for (const rider of riders) {
    // Vehicle type distance enforcement
    if (rider.vehicle_type && deliveryDistanceKm > 0) {
      const maxDist = vehicleMaxDistances[rider.vehicle_type];
      if (maxDist !== undefined && deliveryDistanceKm > maxDist) {
        skippedVehicle++;
        continue;
      }
    }

    const isVendorRider = vendorRiderProfileIds.includes(rider.id) || rider.affiliated_vendor_id === vendorId;
    const isDeliveryCompanyRider = !!rider.delivery_company_id;

    let riderTier: 'vendor_riders' | 'delivery_company_riders' | 'platform_riders';
    if (isVendorRider) riderTier = 'vendor_riders';
    else if (isDeliveryCompanyRider) riderTier = 'delivery_company_riders';
    else riderTier = 'platform_riders';

    if (priorityTier !== 'all' && riderTier !== priorityTier) continue;

    const riderLat = rider.current_latitude || rider.preferred_latitude;
    const riderLon = rider.current_longitude || rider.preferred_longitude;
    if (!riderLat || !riderLon) continue;

    // Check concurrent order limit
    const activeCount = await getRiderActiveOrderCount(supabase, rider.user_id);
    if (activeCount >= maxConcurrentOrders) {
      skippedCapacity++;
      continue;
    }

    const distance = calculateDistance(vendorLat, vendorLon, riderLat, riderLon);
    const riderWorkRadius = rider.work_radius_km || radiusKm;
    if (distance <= radiusKm && distance <= riderWorkRadius) {
      eligibleRiders.push({
        id: rider.id,
        user_id: rider.user_id,
        distance_km: distance,
        priority_tier: riderTier,
        current_latitude: rider.current_latitude,
        current_longitude: rider.current_longitude,
        preferred_latitude: rider.preferred_latitude,
        preferred_longitude: rider.preferred_longitude,
      });
    }
  }

  if (skippedVehicle > 0) {
    console.log(`Skipped ${skippedVehicle} riders due to vehicle type distance limits`);
  }
  if (skippedCapacity > 0) {
    console.log(`Skipped ${skippedCapacity} riders due to concurrent order limit (max: ${maxConcurrentOrders})`);
  }

  return eligibleRiders.sort((a, b) => a.distance_km - b.distance_km);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { orderId, publicOnly }: DispatchOrderRequest = await req.json();

    if (!orderId) {
      return new Response(
        JSON.stringify({ error: 'Order ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Starting dispatch for order ${orderId}`);

    // Get order details with vendor info
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id, vendor_id, status, rider_id, delivery_type, delivery_fee,
        delivery_address_text, environment, outlet_id,
        vendors (id, name, address, latitude, longitude),
        addresses (latitude, longitude)
      `)
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      console.error('Order not found:', orderError);
      return new Response(
        JSON.stringify({ error: 'Order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.delivery_type === 'self_pickup') {
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

    // Clean up old dispatch requests
    const { data: existingDispatches } = await supabase
      .from('dispatch_requests')
      .select('id, status')
      .eq('order_id', orderId);

    if (existingDispatches && existingDispatches.length > 0) {
      for (const existingDispatch of existingDispatches) {
        await supabase.from('dispatch_offers').delete().eq('dispatch_request_id', existingDispatch.id);
        await supabase.from('dispatch_requests').delete().eq('id', existingDispatch.id);
      }
      console.log(`Deleted ${existingDispatches.length} old dispatch request(s)`);
    }

    const vendor = order.vendors as any;

    // If order has an outlet_id, fetch outlet-specific address & coordinates
    let pickupName = vendor?.name || 'Vendor';
    let pickupAddress = vendor?.address || '';
    let pickupLat = vendor?.latitude;
    let pickupLng = vendor?.longitude;

    if (order.outlet_id) {
      const { data: outlet } = await supabase
        .from('vendor_outlets')
        .select('outlet_name, outlet_surname, address, city, state, latitude, longitude')
        .eq('id', order.outlet_id)
        .single();

      if (outlet) {
        // Use outlet coordinates if available, otherwise fall back to vendor
        if (outlet.latitude && outlet.longitude) {
          pickupLat = outlet.latitude;
          pickupLng = outlet.longitude;
        }
        // Use outlet address if available
        if (outlet.address) {
          pickupAddress = outlet.address;
        }
        // Build outlet display name: "Vendor Name – Outlet Surname"
        if (outlet.outlet_surname) {
          pickupName = `${vendor?.name || 'Vendor'} – ${outlet.outlet_surname}`;
        }
        console.log(`Using outlet data: name="${pickupName}", address="${pickupAddress}", coords=(${pickupLat}, ${pickupLng})`);
      }
    }

    if (!pickupLat || !pickupLng) {
      return new Response(
        JSON.stringify({ error: 'Vendor/outlet location not set' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all platform settings at once
    const { data: allSettings } = await supabase
      .from('platform_settings')
      .select('key, value');

    const settingsMap: Record<string, string> = {};
    allSettings?.forEach((s: any) => { settingsMap[s.key] = s.value; });

    const dispatchSettings = {
      acceptanceTimeoutSeconds: parseInt(settingsMap.dispatch_acceptance_timeout_seconds || '60'),
      initialRadiusKm: parseFloat(settingsMap.dispatch_initial_radius_km || '5'),
      maxRetries: parseInt(settingsMap.dispatch_max_retries || '3'),
    };

    const payoutSettings = getPayoutSettings(settingsMap);

    // Calculate delivery distance using Google Maps for accuracy
    const address = order.addresses as any;
    const customerLat = address?.latitude || null;
    const customerLon = address?.longitude || null;
    let deliveryDistanceKm = 0;
    let estimatedDeliveryMinutes = 0;
    if (customerLat && customerLon) {
      const gmResult = await getGoogleMapsDistance(pickupLat, pickupLng, customerLat, customerLon);
      deliveryDistanceKm = gmResult.distanceKm;
      estimatedDeliveryMinutes = gmResult.durationMinutes;
      console.log(`Delivery distance (${gmResult.source}): ${deliveryDistanceKm} km, ETA: ${estimatedDeliveryMinutes} min`);
    }

    // Get max concurrent orders setting
    const maxConcurrentOrders = parseInt(settingsMap.rider_max_concurrent_orders || '1');

    // Find eligible riders from ALL tiers with vehicle distance enforcement and capacity check
    const searchTier = 'all';
    const eligibleRiders = await findEligibleRiders(
      supabase, order.vendor_id, pickupLat, pickupLng,
      dispatchSettings.initialRadiusKm, searchTier, deliveryDistanceKm, maxConcurrentOrders
    );

    console.log(`Found ${eligibleRiders.length} eligible riders`);

    // Auto-detect weather from customer or vendor location
    const weatherLat = customerLat || pickupLat;
    const weatherLon = customerLon || pickupLng;
    const detectedWeather = await fetchWeatherCondition(weatherLat, weatherLon);
    console.log(`Auto-detected weather: ${detectedWeather} at (${weatherLat}, ${weatherLon})`);

    // Re-apply detected weather to payout settings
    const payoutSettingsWithWeather = getPayoutSettings(settingsMap, detectedWeather);

    const expiresAt = new Date(Date.now() + dispatchSettings.acceptanceTimeoutSeconds * 1000);
    const deliveryFee = order.delivery_fee || 0;

    // Calculate rider payout using the hybrid model with auto-detected weather
    const payout = calculateRiderPayout(deliveryFee, deliveryDistanceKm, payoutSettingsWithWeather);

    console.log(`Payout breakdown: fee=₦${payout.deliveryFee}, platform=₦${payout.platformFee}, distBonus=₦${payout.distanceBonus}, surge=₦${payout.totalSurgeBonus}, subsidy=₦${payout.subsidyAmount}, final=₦${payout.finalRiderPay}`);

    // Create dispatch request
    const { data: dispatchRequest, error: dispatchError } = await supabase
      .from('dispatch_requests')
      .insert({
        order_id: orderId,
        vendor_id: order.vendor_id,
        outlet_id: order.outlet_id || null,
        vendor_latitude: pickupLat,
        vendor_longitude: pickupLng,
        customer_latitude: customerLat,
        customer_longitude: customerLon,
        search_radius_km: dispatchSettings.initialRadiusKm,
        priority_tier: 'platform_riders',
        delivery_fee: deliveryFee,
        expires_at: expiresAt.toISOString(),
        max_retries: dispatchSettings.maxRetries,
        environment: order.environment || 'production',
        status: eligibleRiders.length === 0 ? 'no_riders' : 'pending',
      })
      .select()
      .single();

    if (dispatchError) {
      console.error('Error creating dispatch request:', dispatchError);
      throw dispatchError;
    }

    // Create offers with full payout breakdown
    const offers = eligibleRiders.map(rider => ({
      dispatch_request_id: dispatchRequest.id,
      rider_user_id: rider.user_id,
      rider_profile_id: rider.id,
      distance_km: Math.round(rider.distance_km * 100) / 100,
      delivery_fee: deliveryFee,
      rider_share: payout.finalRiderPay,
      platform_fee: payout.platformFee,
      distance_bonus: payout.distanceBonus,
      time_surge_bonus: payout.timeSurgeBonus,
      weather_surge_bonus: payout.weatherSurgeBonus,
      total_surge_bonus: payout.totalSurgeBonus,
      subsidy_amount: payout.subsidyAmount,
      weather_condition: payout.weatherCondition,
      time_period: payout.timePeriod,
      priority_tier: rider.priority_tier,
      vendor_name: pickupName,
      vendor_address: pickupAddress,
      customer_address: order.delivery_address_text,
      estimated_pickup_minutes: Math.ceil((rider.distance_km / 25) * 60),
      estimated_delivery_minutes: customerLat && customerLon
        ? Math.ceil((rider.distance_km / 25) * 60) + Math.ceil((deliveryDistanceKm / 25) * 60)
        : null,
      expires_at: expiresAt.toISOString(),
      status: 'pending',
    }));

    if (offers.length > 0) {
      const { error: offersError } = await supabase.from('dispatch_offers').insert(offers);
      if (offersError) {
        console.error('Error creating dispatch offers:', offersError);
      } else {
        console.log(`Created ${offers.length} dispatch offers with hybrid payout`);
      }

      // Send push notifications to all eligible riders
      const riderUserIds = eligibleRiders.map(r => r.user_id);
      try {
        const notifResponse = await fetch(
          `${supabaseUrl}/functions/v1/send-push-notification`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${supabaseKey}`,
            },
            body: JSON.stringify({
              user_ids: riderUserIds,
              title: '🚴 New Delivery Request!',
              body: `New order from ${pickupName} — ₦${payout.finalRiderPay} payout`,
              data: {
                tag: 'dispatch-offer',
                role: 'rider',
                channel_id: 'rider-orders',
              },
              url: '/rider/available-orders',
            }),
          }
        );
        const notifResult = await notifResponse.json();
        console.log(`Push notifications sent: ${notifResult.sent} sent, ${notifResult.failed} failed`);
      } catch (pushErr) {
        console.error('Failed to send push notifications to riders:', pushErr);
      }
    }

    // Update order status
    await supabase
      .from('orders')
      .update({ status: 'searching_for_rider', updated_at: new Date().toISOString() })
      .eq('id', orderId);

    return new Response(
      JSON.stringify({
        success: true,
        dispatchRequestId: dispatchRequest.id,
        eligibleRiderCount: eligibleRiders.length,
        expiresAt: expiresAt.toISOString(),
        payoutBreakdown: payout,
        message: eligibleRiders.length === 0
          ? 'No riders available, dispatch created for retry'
          : `Dispatched to ${eligibleRiders.length} riders`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in dispatch-order:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
