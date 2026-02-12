import { useState, useEffect, useMemo } from 'react';
import { calculateDeliveryFee } from '@/lib/location';
import { useDeliverySettings } from './useDeliverySettings';
import { supabase } from '@/integrations/supabase/client';

interface UseDeliveryFeeOptions {
  vendorLat: number | null;
  vendorLon: number | null;
  customerLat: number | null;
  customerLon: number | null;
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
  weatherOverride: string;
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
  weatherOverride: 'clear',
};

function getTimePeriod(ss: SurgeSettings): string {
  const hour = new Date().getHours();
  if (hour >= ss.morningStartHour && hour < ss.morningEndHour) return 'morning';
  if (hour >= ss.afternoonStartHour && hour < ss.afternoonEndHour) return 'afternoon';
  if (hour >= ss.nightStartHour || hour < ss.morningStartHour) return 'night';
  return 'morning';
}

function calculateSurge(ss: SurgeSettings): { surgeFee: number; timePeriod: string; weatherCondition: string } {
  if (!ss.surgeEnabled) return { surgeFee: 0, timePeriod: 'morning', weatherCondition: 'clear' };

  const timePeriod = getTimePeriod(ss);
  let timeSurge = 0;
  if (ss.timeSurgeEnabled) {
    if (timePeriod === 'morning') timeSurge = ss.timeSurgeMorning;
    else if (timePeriod === 'afternoon') timeSurge = ss.timeSurgeAfternoon;
    else if (timePeriod === 'night') timeSurge = ss.timeSurgeNight;
  }

  const weatherCondition = ss.weatherOverride || 'clear';
  let weatherSurge = 0;
  if (ss.weatherSurgeEnabled) {
    if (weatherCondition === 'rain') weatherSurge = ss.weatherSurgeRain;
    else if (weatherCondition === 'storm') weatherSurge = ss.weatherSurgeStorm;
    else weatherSurge = ss.weatherSurgeClear;
  }

  const surgeFee = Math.min(timeSurge + weatherSurge, ss.maxSurgeCap);
  return { surgeFee, timePeriod, weatherCondition };
}

export function useDeliveryFee({ vendorLat, vendorLon, customerLat, customerLon }: UseDeliveryFeeOptions) {
  const { settings, loading: settingsLoading } = useDeliverySettings();
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [surgeSettings, setSurgeSettings] = useState<SurgeSettings>(defaultSurgeSettings);
  const [surgeLoading, setSurgeLoading] = useState(true);

  // Fetch surge settings
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
            'rider_weather_override',
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
            weatherOverride: m.rider_weather_override || 'clear',
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

  // Calculate distance when coordinates are available
  useEffect(() => {
    if (vendorLat && vendorLon && customerLat && customerLon) {
      const R = 6371;
      const dLat = (customerLat - vendorLat) * Math.PI / 180;
      const dLon = (customerLon - vendorLon) * Math.PI / 180;
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(vendorLat * Math.PI / 180) * Math.cos(customerLat * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      setDistanceKm(R * c);
    } else {
      setDistanceKm(null);
    }
  }, [vendorLat, vendorLon, customerLat, customerLon]);

  const surge = useMemo(() => calculateSurge(surgeSettings), [surgeSettings]);

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

  const fee = baseFee + surge.surgeFee;

  const isOutOfRange = useMemo(() => {
    if (distanceKm === null) return false;
    return distanceKm > settings.maxDeliveryDistanceKm;
  }, [distanceKm, settings.maxDeliveryDistanceKm]);

  return {
    fee,
    baseFee,
    surgeFee: surge.surgeFee,
    timePeriod: surge.timePeriod,
    weatherCondition: surge.weatherCondition,
    distanceKm,
    isOutOfRange,
    loading: settingsLoading || surgeLoading,
    hasCoordinates: vendorLat !== null && vendorLon !== null && customerLat !== null && customerLon !== null,
  };
}
