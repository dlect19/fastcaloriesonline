import { useState, useEffect, useMemo } from 'react';
import { calculateDistance, calculateDeliveryFee } from '@/lib/location';
import { useDeliverySettings } from './useDeliverySettings';
import { useRiderAvailability } from './useRiderAvailability';
import { supabase } from '@/integrations/supabase/client';

interface UseDeliveryFeeOptions {
  vendorLat: number | null;
  vendorLon: number | null;
  customerLat: number | null;
  customerLon: number | null;
  vendorId?: string | null;
  customerAddressId?: string | null;
}

interface SurgeSettings {
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
}

const defaultSurgeSettings: SurgeSettings = {
  surgeEnabled: true,
  timeSurgeEnabled: true,
  weatherSurgeEnabled: true,
  maxSurgeCap: 500,
  morningStartHour: 6,
  morningEndHour: 12,
  afternoonStartHour: 12,
  afternoonEndHour: 18,
  nightStartHour: 18,
  nightEndHour: 24,
  timeSurgeMorning: 0,
  timeSurgeAfternoon: 100,
  timeSurgeNight: 200,
  weatherSurgeClear: 0,
  weatherSurgeRain: 100,
  weatherSurgeStorm: 300,
};

function getTimePeriod(ss: SurgeSettings): string {
  const hour = new Date().getHours();
  if (hour >= ss.morningStartHour && hour < ss.morningEndHour) return 'morning';
  if (hour >= ss.afternoonStartHour && hour < ss.afternoonEndHour) return 'afternoon';
  if (hour >= ss.nightStartHour || hour < ss.morningStartHour) return 'night';
  return 'morning';
}

/**
 * Read current weather condition from the shared weather_cache table.
 * Cache is populated by the `refresh-weather` edge function on a schedule —
 * customer orders never call an external weather API directly.
 */
async function fetchWeatherCondition(lat: number, lon: number): Promise<string> {
  try {
    const gridKey = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const { data } = await supabase
      .from('weather_cache')
      .select('condition')
      .eq('area_key', gridKey)
      .maybeSingle();
    if (data?.condition) return data.condition;

    // Fallback: latest global row so pricing still works before the cache is warm
    const { data: latest } = await supabase
      .from('weather_cache')
      .select('condition')
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return latest?.condition || 'clear';
  } catch {
    return 'clear';
  }
}

function calculateSurge(ss: SurgeSettings, weatherCondition: string): { surgeFee: number; timePeriod: string; weatherCondition: string } {
  if (!ss.surgeEnabled) return { surgeFee: 0, timePeriod: 'morning', weatherCondition: 'clear' };

  const timePeriod = getTimePeriod(ss);
  let timeSurge = 0;
  if (ss.timeSurgeEnabled) {
    if (timePeriod === 'morning') timeSurge = ss.timeSurgeMorning;
    else if (timePeriod === 'afternoon') timeSurge = ss.timeSurgeAfternoon;
    else if (timePeriod === 'night') timeSurge = ss.timeSurgeNight;
  }

  let weatherSurge = 0;
  if (ss.weatherSurgeEnabled) {
    if (weatherCondition === 'rain') weatherSurge = ss.weatherSurgeRain;
    else if (weatherCondition === 'storm') weatherSurge = ss.weatherSurgeStorm;
    else weatherSurge = ss.weatherSurgeClear;
  }

  const surgeFee = Math.min(timeSurge + weatherSurge, ss.maxSurgeCap);
  return { surgeFee, timePeriod, weatherCondition };
}

export function useDeliveryFee({ vendorLat, vendorLon, customerLat, customerLon, vendorId, customerAddressId }: UseDeliveryFeeOptions) {
  const { settings, loading: settingsLoading } = useDeliverySettings();
  const riderAvailability = useRiderAvailability();
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [surgeSettings, setSurgeSettings] = useState<SurgeSettings>(defaultSurgeSettings);
  const [surgeLoading, setSurgeLoading] = useState(true);
  const [weatherCondition, setWeatherCondition] = useState<string>('clear');

  // Fetch surge settings from DB
  useEffect(() => {
    const fetchSurge = async () => {
      try {
        const { data } = await supabase
          .from('platform_settings')
          .select('key, value')
          .in('key', [
            'rider_surge_enabled', 'rider_time_surge_enabled', 'rider_weather_surge_enabled',
            'rider_max_surge_cap',
            'rider_morning_start_hour', 'rider_morning_end_hour',
            'rider_afternoon_start_hour', 'rider_afternoon_end_hour',
            'rider_night_start_hour', 'rider_night_end_hour',
            'rider_time_surge_morning', 'rider_time_surge_afternoon', 'rider_time_surge_night',
            'rider_weather_surge_clear', 'rider_weather_surge_rain', 'rider_weather_surge_storm',
          ]);

        if (data) {
          const m: Record<string, string> = {};
          data.forEach(s => { m[s.key] = s.value; });
          setSurgeSettings({
            surgeEnabled: m.rider_surge_enabled !== 'false',
            timeSurgeEnabled: m.rider_time_surge_enabled !== 'false',
            weatherSurgeEnabled: m.rider_weather_surge_enabled !== 'false',
            maxSurgeCap: parseFloat(m.rider_max_surge_cap || '500'),
            morningStartHour: parseInt(m.rider_morning_start_hour || '6'),
            morningEndHour: parseInt(m.rider_morning_end_hour || '12'),
            afternoonStartHour: parseInt(m.rider_afternoon_start_hour || '12'),
            afternoonEndHour: parseInt(m.rider_afternoon_end_hour || '18'),
            nightStartHour: parseInt(m.rider_night_start_hour || '18'),
            nightEndHour: parseInt(m.rider_night_end_hour || '24'),
            timeSurgeMorning: parseFloat(m.rider_time_surge_morning || '0'),
            timeSurgeAfternoon: parseFloat(m.rider_time_surge_afternoon || '100'),
            timeSurgeNight: parseFloat(m.rider_time_surge_night || '200'),
            weatherSurgeClear: parseFloat(m.rider_weather_surge_clear || '0'),
            weatherSurgeRain: parseFloat(m.rider_weather_surge_rain || '100'),
            weatherSurgeStorm: parseFloat(m.rider_weather_surge_storm || '300'),
          });
        }
      } catch (err) {
        console.error('Error fetching surge settings:', err);
      } finally {
        setSurgeLoading(false);
      }
    };
    fetchSurge();
  }, []);

  // Fetch real weather based on customer location
  useEffect(() => {
    if (customerLat && customerLon) {
      fetchWeatherCondition(customerLat, customerLon).then(setWeatherCondition);
    }
  }, [customerLat, customerLon]);

  // Calculate distance using Google Maps API (primary) with Haversine fallback
  const [distanceLoading, setDistanceLoading] = useState(false);

  // Close-proximity threshold: distances under 0.5km are treated as 0 (GPS drift compensation)
  const PROXIMITY_THRESHOLD_KM = 0.5;

  useEffect(() => {
    if (vendorLat && vendorLon && customerLat && customerLon) {
      setDistanceLoading(true);

      // Quick Haversine pre-check: if straight-line < threshold, skip API call
      const quickDist = calculateDistance(customerLat, customerLon, vendorLat, vendorLon);
      if (quickDist < PROXIMITY_THRESHOLD_KM) {
        console.log(`Close proximity (${(quickDist * 1000).toFixed(0)}m) — treating as 0km`);
        setDistanceKm(0);
        setDistanceLoading(false);
        return;
      }

      // Session-scoped client cache: prevents re-invoking the edge function
      // when the cart is re-mounted (nav away and back) within the same tab.
      // Key uses ~110m precision so tiny GPS drift still hits the cache.
      const r3 = (n: number) => n.toFixed(3);
      const sessionKey = `fc_dist_${vendorId || 'nov'}_${customerAddressId || `${r3(customerLat)},${r3(customerLon)}`}_${r3(vendorLat)},${r3(vendorLon)}`;
      try {
        const cached = sessionStorage.getItem(sessionKey);
        if (cached) {
          const km = Number(cached);
          if (!isNaN(km)) {
            console.log(`[DeliveryFee] session cache hit: ${km}km`);
            setDistanceKm(km);
            setDistanceLoading(false);
            return;
          }
        }
      } catch {}

      const haversineDist = calculateDistance(customerLat!, customerLon!, vendorLat!, vendorLon!);

      // Try Google Maps via edge function (uses shared helper with automatic Haversine fallback)
      supabase.functions.invoke('calculate-distance', {
        body: { originLat: vendorLat, originLng: vendorLon, destLat: customerLat, destLng: customerLon, vendorId, customerAddressId },
      }).then(({ data, error }) => {
        if (data?.distanceInKm !== undefined && !error) {
          const dist = data.distanceInKm < PROXIMITY_THRESHOLD_KM ? 0 : data.distanceInKm;
          setDistanceKm(dist);
          try { sessionStorage.setItem(sessionKey, String(dist)); } catch {}
        } else {
          console.warn('[DeliveryFee] Edge function failed, using Haversine fallback:', error);
          const adjustedDist = haversineDist < PROXIMITY_THRESHOLD_KM ? 0 : Math.round(haversineDist * 1.3 * 10) / 10;
          setDistanceKm(adjustedDist);
          try { sessionStorage.setItem(sessionKey, String(adjustedDist)); } catch {}
        }
      }).catch((err) => {
        console.warn('[DeliveryFee] calculate-distance invocation failed:', err);
        const adjustedDist = haversineDist < PROXIMITY_THRESHOLD_KM ? 0 : Math.round(haversineDist * 1.3 * 10) / 10;
        setDistanceKm(adjustedDist);
      }).finally(() => setDistanceLoading(false));
    } else {
      setDistanceKm(null);
    }
  }, [vendorLat, vendorLon, customerLat, customerLon, vendorId, customerAddressId]);

  const surge = useMemo(() => calculateSurge(surgeSettings, weatherCondition), [surgeSettings, weatherCondition]);

  const baseFee = useMemo(() => {
    if (distanceKm === null || settingsLoading) {
      return settings.baseDeliveryFee;
    }
    return calculateDeliveryFee(
      distanceKm,
      settings.baseDeliveryFee,
      settings.baseDeliveryDistanceKm,
      settings.perKmFee
    );
  }, [distanceKm, settings, settingsLoading]);

  // Add supply-based surge on top
  const supplySurgeFee = useMemo(() => {
    if (!riderAvailability.supplyBasedSurge.isActive) return 0;
    return Math.round(baseFee * (riderAvailability.supplyBasedSurge.currentSurgePct / 100));
  }, [baseFee, riderAvailability.supplyBasedSurge]);

  const fee = baseFee + surge.surgeFee + supplySurgeFee;

  const isOutOfRange = useMemo(() => {
    if (distanceKm === null) return false;
    return distanceKm > settings.maxDeliveryDistanceKm;
  }, [distanceKm, settings.maxDeliveryDistanceKm]);

  return {
    fee,
    baseFee,
    surgeFee: surge.surgeFee + supplySurgeFee,
    timePeriod: surge.timePeriod,
    weatherCondition: surge.weatherCondition,
    supplySurgeActive: riderAvailability.supplyBasedSurge.isActive,
    supplySurgePct: riderAvailability.supplyBasedSurge.currentSurgePct,
    distanceKm,
    isOutOfRange,
    loading: settingsLoading || surgeLoading || distanceLoading,
    hasCoordinates: vendorLat !== null && vendorLon !== null && customerLat !== null && customerLon !== null,
  };
}
