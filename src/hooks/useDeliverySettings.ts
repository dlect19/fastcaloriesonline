import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface DeliverySettings {
  vendorDeliveryRadiusKm: number;
  riderSearchRadiusKm: number;
  baseDeliveryFee: number;
  baseDeliveryDistanceKm: number;
  perKmFee: number;
  maxDeliveryDistanceKm: number;
}

const defaultSettings: DeliverySettings = {
  vendorDeliveryRadiusKm: 20,
  riderSearchRadiusKm: 5,
  baseDeliveryFee: 500,
  baseDeliveryDistanceKm: 1,
  perKmFee: 300,
  maxDeliveryDistanceKm: 15,
};

export function useDeliverySettings() {
  const [settings, setSettings] = useState<DeliverySettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const { data, error: fetchError } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', [
          'vendor_delivery_radius_km',
          'rider_search_radius_km',
          'base_delivery_fee',
          'base_delivery_distance_km',
          'per_km_fee',
          'max_delivery_distance_km',
        ]);

      if (fetchError) throw fetchError;

      if (data) {
        const settingsMap = data.reduce((acc, item) => {
          acc[item.key] = item.value;
          return acc;
        }, {} as Record<string, string>);

        setSettings({
          vendorDeliveryRadiusKm: parseFloat(settingsMap['vendor_delivery_radius_km']) || defaultSettings.vendorDeliveryRadiusKm,
          riderSearchRadiusKm: parseFloat(settingsMap['rider_search_radius_km']) || defaultSettings.riderSearchRadiusKm,
          baseDeliveryFee: parseFloat(settingsMap['base_delivery_fee']) || defaultSettings.baseDeliveryFee,
          baseDeliveryDistanceKm: parseFloat(settingsMap['base_delivery_distance_km']) || defaultSettings.baseDeliveryDistanceKm,
          perKmFee: parseFloat(settingsMap['per_km_fee']) || defaultSettings.perKmFee,
          maxDeliveryDistanceKm: parseFloat(settingsMap['max_delivery_distance_km']) || defaultSettings.maxDeliveryDistanceKm,
        });
      }
    } catch (err) {
      console.error('Error fetching delivery settings:', err);
      setError('Failed to load delivery settings');
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = async (key: string, value: string) => {
    try {
      const { error: updateError } = await supabase
        .from('platform_settings')
        .update({ value, updated_at: new Date().toISOString() })
        .eq('key', key);

      if (updateError) throw updateError;

      // Refresh settings
      await fetchSettings();
      return true;
    } catch (err) {
      console.error('Error updating delivery setting:', err);
      return false;
    }
  };

  return {
    settings,
    loading,
    error,
    updateSetting,
    refetch: fetchSettings,
  };
}
