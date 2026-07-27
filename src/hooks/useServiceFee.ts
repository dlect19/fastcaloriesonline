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
  type: 'fixed', fixed: 100, percentage: 5, min: 100, max: 1000,
};
const defaultPickupConfig: ServiceFeeConfig = {
  type: 'fixed', fixed: 50, percentage: 3, min: 50, max: 500,
};
const defaultPharmacyConfig: ServiceFeeConfig = {
  type: 'hybrid', fixed: 100, percentage: 15, min: 100, max: 5000,
};
const defaultGroceryConfig: ServiceFeeConfig = {
  type: 'hybrid', fixed: 100, percentage: 15, min: 100, max: 7500,
};

export type VendorFeeCategory = 'food' | 'pharmacy' | 'grocery' | null | undefined;

function normalizeCategory(cat?: string | null): VendorFeeCategory {
  if (!cat) return 'food';
  const c = cat.toLowerCase();
  if (c === 'pharmacy') return 'pharmacy';
  if (c === 'grocery' || c === 'market' || c === 'marketplace') return 'grocery';
  return 'food';
}

export function useServiceFee() {
  const [deliveryConfig, setDeliveryConfig] = useState<ServiceFeeConfig>(defaultDeliveryConfig);
  const [pickupConfig, setPickupConfig] = useState<ServiceFeeConfig>(defaultPickupConfig);
  const [pharmacyConfig, setPharmacyConfig] = useState<ServiceFeeConfig>(defaultPharmacyConfig);
  const [groceryConfig, setGroceryConfig] = useState<ServiceFeeConfig>(defaultGroceryConfig);
  const [includeTwilio, setIncludeTwilio] = useState<boolean>(false);
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
            'service_fee_type_pharmacy', 'service_fee_fixed_pharmacy', 'service_fee_percentage_pharmacy',
            'service_fee_min_pharmacy', 'service_fee_max_pharmacy',
            'service_fee_type_grocery', 'service_fee_fixed_grocery', 'service_fee_percentage_grocery',
            'service_fee_min_grocery', 'service_fee_max_grocery',
            'service_fee_include_twilio',
          ]);

        if (data) {
          const m: Record<string, string> = {};
          data.forEach(s => { m[s.key] = s.value as string; });

          const build = (suffix: string, def: ServiceFeeConfig): ServiceFeeConfig => ({
            type: (m[`service_fee_type${suffix}`] as ServiceFeeConfig['type']) || def.type,
            fixed: parseFloat(m[`service_fee_fixed${suffix}`] || String(def.fixed)),
            percentage: parseFloat(m[`service_fee_percentage${suffix}`] || String(def.percentage)),
            min: parseFloat(m[`service_fee_min${suffix}`] || String(def.min)),
            max: parseFloat(m[`service_fee_max${suffix}`] || String(def.max)),
          });

          setDeliveryConfig(build('', defaultDeliveryConfig));
          setPickupConfig(build('_pickup', defaultPickupConfig));
          setPharmacyConfig(build('_pharmacy', defaultPharmacyConfig));
          setGroceryConfig(build('_grocery', defaultGroceryConfig));
          setIncludeTwilio(String(m.service_fee_include_twilio || 'false') === 'true');
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

  const calculateServiceFee = useCallback((
    orderAmount: number,
    deliveryType: string = 'delivery',
    vendorCategory?: string | null,
  ): number => {
    const cat = normalizeCategory(vendorCategory);
    if (cat === 'pharmacy') return calcFee(pharmacyConfig, orderAmount);
    if (cat === 'grocery') return calcFee(groceryConfig, orderAmount);
    // Food (default): delivery vs carryout
    const config = deliveryType === 'self_pickup' ? pickupConfig : deliveryConfig;
    return calcFee(config, orderAmount);
  }, [deliveryConfig, pickupConfig, pharmacyConfig, groceryConfig]);

  const getOrderTwilioSurcharge = useCallback(async (orderId: string | null | undefined): Promise<number> => {
    if (!includeTwilio || !orderId) return 0;
    const { data, error } = await supabase
      .from('twilio_api_logs')
      .select('price_ngn')
      .eq('order_id', orderId);
    if (error || !data) return 0;
    return data.reduce((s: number, r: any) => s + Number(r.price_ngn || 0), 0);
  }, [includeTwilio]);

  return {
    deliveryConfig,
    pickupConfig,
    pharmacyConfig,
    groceryConfig,
    config: deliveryConfig,
    calculateServiceFee,
    includeTwilio,
    getOrderTwilioSurcharge,
    loading,
  };
}
