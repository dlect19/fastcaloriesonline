import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface PlatformSettings {
  default_navigation_app: string | null;
  payout_approval_mode: string | null;
  platform_environment: string | null;
  [key: string]: string | null;
}

export function usePlatformSettings() {
  const [settings, setSettings] = useState<PlatformSettings>({
    default_navigation_app: null,
    payout_approval_mode: null,
    platform_environment: null,
  });
  const [loading, setLoading] = useState(true);

  const fetchSettings = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('key, value');

      if (error) throw error;

      const settingsMap: PlatformSettings = {
        default_navigation_app: null,
        payout_approval_mode: null,
        platform_environment: null,
      };

      data?.forEach((item) => {
        settingsMap[item.key] = item.value;
      });

      setSettings(settingsMap);
    } catch (error) {
      console.error('Error fetching platform settings:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateSetting = useCallback(async (key: string, value: string) => {
    try {
      const { error } = await supabase
        .from('platform_settings')
        .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

      if (error) throw error;

      setSettings(prev => ({ ...prev, [key]: value }));
      return true;
    } catch (error) {
      console.error('Error updating setting:', error);
      return false;
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  return { settings, loading, refetch: fetchSettings, updateSetting };
}
