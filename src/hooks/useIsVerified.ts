import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// Simple in-memory cache to avoid N+1 across list surfaces.
const cache = new Map<string, boolean>();
const inflight = new Map<string, Promise<boolean>>();

export function useIsVerified(userId?: string | null): boolean {
  const [verified, setVerified] = useState<boolean>(userId ? cache.get(userId) ?? false : false);

  useEffect(() => {
    if (!userId) return;
    if (cache.has(userId)) {
      setVerified(cache.get(userId)!);
      return;
    }
    const existing = inflight.get(userId);
    const p = existing ?? (async () => {
      const { data, error } = await supabase.rpc('is_user_verified', { _user_id: userId });
      const v = !error && data === true;
      cache.set(userId, v);
      inflight.delete(userId);
      return v;
    })();
    if (!existing) inflight.set(userId, p);
    p.then((v) => setVerified(v));
  }, [userId]);

  return verified;
}
