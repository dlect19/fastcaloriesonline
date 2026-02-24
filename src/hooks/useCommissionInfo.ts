import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface CommissionInfo {
  rate: number;
  source: 'global_default' | 'custom_override';
  type: 'percentage' | 'fixed' | 'hybrid';
  loading: boolean;
}

export function useCommissionInfo(entityType: 'vendor' | 'rider' | 'logistics', entityId: string | null) {
  const [info, setInfo] = useState<CommissionInfo>({
    rate: 15,
    source: 'global_default',
    type: 'percentage',
    loading: true,
  });

  useEffect(() => {
    if (!entityId) return;

    const fetchCommission = async () => {
      try {
        // Check for personal override first
        const { data: override } = await supabase
          .from('commission_overrides')
          .select('*')
          .eq('entity_type', entityType)
          .eq('entity_id', entityId)
          .maybeSingle();

        if (override) {
          setInfo({
            rate: override.percentage_value ?? override.fixed_value ?? 15,
            source: 'custom_override',
            type: override.commission_type as CommissionInfo['type'],
            loading: false,
          });
          return;
        }

        // Fall back to global default
        let settingKey = 'default_vendor_commission_rate';
        if (entityType === 'rider' || entityType === 'logistics') settingKey = 'rider_platform_fee_pct';

        const { data: setting } = await supabase
          .from('platform_settings')
          .select('value')
          .eq('key', settingKey)
          .maybeSingle();

        setInfo({
          rate: parseFloat(setting?.value || '15'),
          source: 'global_default',
          type: 'percentage',
          loading: false,
        });
      } catch (err) {
        console.error('Error fetching commission info:', err);
        setInfo(prev => ({ ...prev, loading: false }));
      }
    };

    fetchCommission();
  }, [entityType, entityId]);

  return info;
}
