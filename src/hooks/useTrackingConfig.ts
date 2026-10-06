import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { DEFAULT_TRACKING_CONFIG, parseTrackingConfig, TRACKING_SETTING_KEYS, type TrackingConfig } from '@/lib/riderTracking';

export function useTrackingConfig(): TrackingConfig {
  const [cfg, setCfg] = useState<TrackingConfig>(DEFAULT_TRACKING_CONFIG);
  useEffect(() => {
    let cancelled = false;
    supabase.from('platform_settings').select('key, value').in('key', Object.values(TRACKING_SETTING_KEYS))
      .then(({ data }) => {
        if (cancelled || !data) return;
        setCfg(parseTrackingConfig(Object.fromEntries(data.map((r: any) => [r.key, r.value]))));
      });
    return () => { cancelled = true; };
  }, []);
  return cfg;
}
