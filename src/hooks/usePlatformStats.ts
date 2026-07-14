import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface PlatformStats {
  vendors: { active: number; total: number };
  riders: { verified: number; total: number; online_now: number };
  coverage: { cities: number };
  orders: { delivered: number };
  users: { total: number };
}

/** Format a count as "1.2K+", "50K+", "1.3M+" etc. */
export function formatCount(n: number | undefined | null, suffix = '+'): string {
  const v = Number(n || 0);
  if (v <= 0) return '0';
  if (v < 1000) return `${v}${suffix}`;
  if (v < 10_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}K${suffix}`;
  if (v < 1_000_000) return `${Math.floor(v / 1000)}K${suffix}`;
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M${suffix}`;
}

let cache: PlatformStats | null = null;
let cacheAt = 0;

export function usePlatformStats() {
  const [stats, setStats] = useState<PlatformStats | null>(cache);
  const [loading, setLoading] = useState(!cache);

  useEffect(() => {
    let cancel = false;
    const now = Date.now();
    if (cache && now - cacheAt < 60_000) {
      setStats(cache);
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const { data, error } = await supabase.functions.invoke('public-platform-stats');
        if (error) throw error;
        if (!cancel && data) {
          cache = data as PlatformStats;
          cacheAt = Date.now();
          setStats(cache);
        }
      } catch (e) {
        console.warn('[usePlatformStats]', e);
      } finally {
        if (!cancel) setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, []);

  return { stats, loading };
}
