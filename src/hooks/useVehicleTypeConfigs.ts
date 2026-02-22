import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface VehicleTypeConfig {
  id: string;
  vehicle_type: string;
  display_name: string;
  max_delivery_distance_km: number;
  base_delivery_rate: number;
  per_km_rate: number | null;
  is_active: boolean;
  sort_order: number;
}

export function useVehicleTypeConfigs() {
  const [configs, setConfigs] = useState<VehicleTypeConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchConfigs = async () => {
    try {
      const { data, error } = await supabase
        .from('vehicle_type_configs')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setConfigs(data || []);
    } catch (err) {
      console.error('Error fetching vehicle type configs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const getConfigForVehicle = (vehicleType: string): VehicleTypeConfig | undefined => {
    return configs.find(c => c.vehicle_type === vehicleType);
  };

  return { configs, loading, refetch: fetchConfigs, getConfigForVehicle };
}
