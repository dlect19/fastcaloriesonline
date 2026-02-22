import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ServiceFeeConfig {
  type: 'fixed' | 'percentage' | 'hybrid';
  fixed: number;
  percentage: number;
  min: number;
  max: number;
}

const defaultConfig: ServiceFeeConfig = {
  type: 'fixed',
  fixed: 100,
  percentage: 5,
  min: 100,
  max: 1000,
};

export function useServiceFee() {
  const [config, setConfig] = useState<ServiceFeeConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const { data } = await supabase
          .from('platform_settings')
          .select('key, value')
          .in('key', [
            'service_fee_type',
            'service_fee_fixed',
            'service_fee_percentage',
            'service_fee_min',
            'service_fee_max',
          ]);

        if (data) {
          const m: Record<string, string> = {};
          data.forEach(s => { m[s.key] = s.value; });
          setConfig({
            type: (m.service_fee_type as ServiceFeeConfig['type']) || 'fixed',
            fixed: parseFloat(m.service_fee_fixed || '100'),
            percentage: parseFloat(m.service_fee_percentage || '5'),
            min: parseFloat(m.service_fee_min || '100'),
            max: parseFloat(m.service_fee_max || '1000'),
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

  const calculateServiceFee = useCallback((orderAmount: number): number => {
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
  }, [config]);

  return { config, calculateServiceFee, loading };
}
