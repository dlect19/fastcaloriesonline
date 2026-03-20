import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface RiderAvailabilityState {
  isWithinOperatingHours: boolean;
  hasOnlineRiders: boolean;
  onlineRiderCount: number;
  totalRiders: number;
  ridersOnDelivery: number;
  ridersOffline: number;
  openingHour: number;
  closingHour: number;
  operatingHoursEnabled: boolean;
  supplyBasedSurge: {
    enabled: boolean;
    minThreshold: number;
    surgePct: number;
    criticalThreshold: number;
    emergencySurgePct: number;
    currentSurgePct: number;
    isActive: boolean;
    level: 'none' | 'normal' | 'emergency';
  };
  loading: boolean;
  deliveryAllowed: boolean;
  blockReason: string | null;
}

export function useRiderAvailability() {
  const [state, setState] = useState<RiderAvailabilityState>({
    isWithinOperatingHours: true,
    hasOnlineRiders: true,
    onlineRiderCount: 0,
    totalRiders: 0,
    ridersOnDelivery: 0,
    ridersOffline: 0,
    openingHour: 8,
    closingHour: 22,
    operatingHoursEnabled: true,
    supplyBasedSurge: {
      enabled: false,
      minThreshold: 5,
      surgePct: 15,
      criticalThreshold: 2,
      emergencySurgePct: 25,
      currentSurgePct: 0,
      isActive: false,
      level: 'none',
    },
    loading: true,
    deliveryAllowed: true,
    blockReason: null,
  });

  const fetchAvailability = useCallback(async () => {
    try {
      // Fetch settings and rider counts in parallel
      const [settingsResult, ridersResult, onDeliveryResult] = await Promise.all([
        supabase.from('platform_settings').select('key, value').in('key', [
          'rider_operating_hours_enabled', 'rider_opening_hour', 'rider_closing_hour',
          'rider_supply_surge_enabled', 'rider_supply_min_threshold', 'rider_supply_surge_pct',
          'rider_supply_critical_threshold', 'rider_supply_emergency_surge_pct',
          'rider_checkout_availability_check',
        ]),
        supabase.from('rider_profiles').select('id, is_online, is_verified', { count: 'exact' }).eq('is_verified', true),
        supabase.from('orders').select('id', { count: 'exact', head: true }).in('status', ['picked_up', 'on_the_way']),
      ]);

      const sm: Record<string, string> = {};
      settingsResult.data?.forEach(s => { sm[s.key] = s.value; });

      const opEnabled = sm.rider_operating_hours_enabled !== 'false';
      const openHour = parseInt(sm.rider_opening_hour || '8');
      const closeHour = parseInt(sm.rider_closing_hour || '22');
      const currentHour = new Date().getHours();

      let withinHours = true;
      if (opEnabled) {
        if (openHour < closeHour) {
          withinHours = currentHour >= openHour && currentHour < closeHour;
        } else {
          // Overnight range (e.g., 22:00 - 06:00)
          withinHours = currentHour >= openHour || currentHour < closeHour;
        }
      }

      const totalRiders = ridersResult.data?.length || 0;
      const onlineRiders = ridersResult.data?.filter(r => r.is_online).length || 0;
      const ridersOnDelivery = onDeliveryResult.count || 0;
      const ridersOffline = totalRiders - onlineRiders;

      // Supply surge
      const surgeEnabled = sm.rider_supply_surge_enabled === 'true';
      const minThreshold = parseInt(sm.rider_supply_min_threshold || '5');
      const surgePct = parseFloat(sm.rider_supply_surge_pct || '15');
      const criticalThreshold = parseInt(sm.rider_supply_critical_threshold || '2');
      const emergencySurgePct = parseFloat(sm.rider_supply_emergency_surge_pct || '25');

      let currentSurgePct = 0;
      let surgeLevel: 'none' | 'normal' | 'emergency' = 'none';
      if (surgeEnabled && onlineRiders <= criticalThreshold) {
        currentSurgePct = emergencySurgePct;
        surgeLevel = 'emergency';
      } else if (surgeEnabled && onlineRiders <= minThreshold) {
        currentSurgePct = surgePct;
        surgeLevel = 'normal';
      }

      // Delivery allowed logic
      const checkEnabled = sm.rider_checkout_availability_check !== 'false';
      let deliveryAllowed = true;
      let blockReason: string | null = null;

      if (checkEnabled) {
        if (opEnabled && !withinHours) {
          deliveryAllowed = false;
          blockReason = `Delivery service is currently unavailable. Operating hours: ${openHour}:00 - ${closeHour}:00. Please select Carryout.`;
        } else if (onlineRiders === 0) {
          deliveryAllowed = false;
          blockReason = 'No riders available at the moment. To avoid long waiting time, please select Carryout.';
        }
      }

      setState({
        isWithinOperatingHours: withinHours,
        hasOnlineRiders: onlineRiders > 0,
        onlineRiderCount: onlineRiders,
        totalRiders,
        ridersOnDelivery,
        ridersOffline,
        openingHour: openHour,
        closingHour: closeHour,
        operatingHoursEnabled: opEnabled,
        supplyBasedSurge: {
          enabled: surgeEnabled,
          minThreshold,
          surgePct,
          criticalThreshold,
          emergencySurgePct,
          currentSurgePct,
          isActive: surgeLevel !== 'none',
          level: surgeLevel,
        },
        loading: false,
        deliveryAllowed,
        blockReason,
      });
    } catch (err) {
      console.error('Error fetching rider availability:', err);
      setState(prev => ({ ...prev, loading: false }));
    }
  }, []);

  useEffect(() => {
    fetchAvailability();
    // Refresh every 60 seconds
    const interval = setInterval(fetchAvailability, 60000);
    return () => clearInterval(interval);
  }, [fetchAvailability]);

  return { ...state, refetch: fetchAvailability };
}
