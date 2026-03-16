import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ServiceFeeConfig {
  type: 'fixed' | 'percentage' | 'hybrid';
  fixed: number;
  percentage: number;
  min: number;
  max: number;
}

const defaultDeliveryConfig: ServiceFeeConfig = {
  type: 'fixed',
  fixed: 100,
  percentage: 5,
  min: 100,
  max: 1000,
};

const defaultPickupConfig: ServiceFeeConfig = {
  type: 'fixed',
  fixed: 50,
  percentage: 3,
  min: 50,
  max: 500,
};

export function useServiceFee() {
  const [deliveryConfig, setDeliveryConfig] = useState<ServiceFeeConfig>(defaultDeliveryConfig);
  const [pickupConfig, setPickupConfig] = useState<ServiceFeeConfig>(defaultPickupConfig);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const { data } = await supabase
          .from('platform_settings')
          .select('key, value')
          .in('key', [
            'service_fee_type', 'service_fee_fixed', 'service_fee_percentage',
            'service_fee_min', 'service_fee_max',
            'service_fee_type_pickup', 'service_fee_fixed_pickup', 'service_fee_percentage_pickup',
            'service_fee_min_pickup', 'service_fee_max_pickup',
          ]);

        if (data) {
          const m: Record<string, string> = {};
          data.forEach(s => { m[s.key] = s.value; });

          setDeliveryConfig({
            type: (m.service_fee_type as ServiceFeeConfig['type']) || 'fixed',
            fixed: parseFloat(m.service_fee_fixed || '100'),
            percentage: parseFloat(m.service_fee_percentage || '5'),
            min: parseFloat(m.service_fee_min || '100'),
            max: parseFloat(m.service_fee_max || '1000'),
          });

          setPickupConfig({
            type: (m.service_fee_type_pickup as ServiceFeeConfig['type']) || 'fixed',
            fixed: parseFloat(m.service_fee_fixed_pickup || '50'),
            percentage: parseFloat(m.service_fee_percentage_pickup || '3'),
            min: parseFloat(m.service_fee_min_pickup || '50'),
            max: parseFloat(m.service_fee_max_pickup || '500'),
          });
        }
      } catch (err) {
        console.error('Error fetching service fee config:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  const calcFee = (config: ServiceFeeConfig, orderAmount: number): number => {
    switch (config.type) {
      case 'fixed':
        return config.fixed;
      case 'percentage':
        return Math.round(orderAmount * (config.percentage / 100));
      case 'hybrid': {
        const calculated = orderAmount * (config.percentage / 100);
        return Math.round(Math.min(Math.max(calculated, config.min), config.max));
      }
      default:
        return config.fixed;
    }
  };

  const calculateServiceFee = useCallback((orderAmount: number, deliveryType: string = 'delivery'): number => {
    const config = deliveryType === 'self_pickup' ? pickupConfig : deliveryConfig;
    return calcFee(config, orderAmount);
  }, [deliveryConfig, pickupConfig]);

  return { deliveryConfig, pickupConfig, config: deliveryConfig, calculateServiceFee, loading };
}
