import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

/** Only persisted events count; counter updates are atomic database triggers. */
export function useAdImpressionTracker() {
  const trackedRef = useRef(new Set<string>());
  const pendingRef = useRef(new Set<string>());

  const persist = useCallback(async (
    eventType: 'view' | 'click', advertisementId: string | null,
    adPlacementId?: string | null,
  ): Promise<boolean> => {
    if (!advertisementId && !adPlacementId) return false;
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser();
      if (authError || !user) return false;
      const { error } = await supabase.from('ad_impressions').insert({
        advertisement_id: advertisementId,
        ad_placement_id: adPlacementId || null,
        viewer_user_id: user.id,
        event_type: eventType,
      });
      if (error) {
        console.warn('Ad event was not saved', error.code);
        return false;
      }
      return true;
    } catch {
      console.warn('Ad event was not saved');
      return false;
    }
  }, []);

  const trackImpression = useCallback(async (
    advertisementId: string | null, adPlacementId?: string | null,
  ) => {
    const key = adPlacementId || advertisementId;
    if (!key || trackedRef.current.has(key) || pendingRef.current.has(key)) return false;
    pendingRef.current.add(key);
    try {
      const saved = await persist('view', advertisementId, adPlacementId);
      if (saved) trackedRef.current.add(key);
      return saved;
    } finally {
      pendingRef.current.delete(key);
    }
  }, [persist]);

  const trackClick = useCallback((advertisementId: string | null, adPlacementId?: string | null) =>
    persist('click', advertisementId, adPlacementId), [persist]);

  return { trackImpression, trackClick };
}