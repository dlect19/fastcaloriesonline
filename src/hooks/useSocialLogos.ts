import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

let cachedLogos: Record<string, string> | null = null;
let fetchPromise: Promise<Record<string, string>> | null = null;

async function fetchSocialLogos(): Promise<Record<string, string>> {
  const keys = ['social_logo_instagram', 'social_logo_tiktok', 'social_logo_x', 'social_logo_facebook', 'social_logo_whatsapp', 'social_logo_youtube'];
  const { data } = await supabase
    .from('platform_settings')
    .select('key, value')
    .in('key', keys);

  const map: Record<string, string> = {};
  data?.forEach(item => {
    const platform = item.key.replace('social_logo_', '');
    if (item.value) map[platform] = item.value;
  });
  return map;
}

export function useSocialLogos() {
  const [logos, setLogos] = useState<Record<string, string>>(cachedLogos || {});

  useEffect(() => {
    if (cachedLogos) {
      setLogos(cachedLogos);
      return;
    }
    if (!fetchPromise) {
      fetchPromise = fetchSocialLogos().then(result => {
        cachedLogos = result;
        return result;
      });
    }
    fetchPromise.then(setLogos);
  }, []);

  return logos;
}
