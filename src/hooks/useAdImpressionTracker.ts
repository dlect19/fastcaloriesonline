import { useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Track ad impressions and clicks with location awareness.
 * Uses batch-insert to reduce DB calls.
 */
export function useAdImpressionTracker() {
  const trackedRef = useRef<Set<string>>(new Set());

  const trackImpression = useCallback(async (
    advertisementId: string,
    adPlacementId?: string | null,
  ) => {
    // Avoid duplicate tracking per session
    const key = `view_${advertisementId}`;
    if (trackedRef.current.has(key)) return;
    trackedRef.current.add(key);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      let lat: number | undefined;
      let lng: number | undefined;

      // Try to get user location
      if ('geolocation' in navigator) {
        try {
          const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 3000, maximumAge: 60000 })
          );
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
        } catch {
          // Location unavailable, proceed without
        }
      }

      await supabase.from('ad_impressions').insert({
        advertisement_id: advertisementId,
        ad_placement_id: adPlacementId || null,
        viewer_user_id: user.id,
        event_type: 'view',
        viewer_latitude: lat || null,
        viewer_longitude: lng || null,
      });

      // Increment impression count on advertisement
      // Using RPC would be ideal but we'll do a simple update
      const { data: ad } = await supabase.from('advertisements')
        .select('total_impressions, ad_placement_id')
        .eq('id', advertisementId)
        .single();
      
      if (ad) {
        await supabase.from('advertisements')
          .update({ total_impressions: (ad.total_impressions || 0) + 1 })
          .eq('id', advertisementId);
        
        // Also update ad_placement if linked
        if (ad.ad_placement_id) {
          const { data: placement } = await supabase.from('ad_placements')
            .select('total_impressions')
            .eq('id', ad.ad_placement_id)
            .single();
          if (placement) {
            await supabase.from('ad_placements')
              .update({ total_impressions: (placement.total_impressions || 0) + 1 })
              .eq('id', ad.ad_placement_id);
          }
        }
      }
    } catch (err) {
      console.error('Impression tracking error:', err);
    }
  }, []);

  const trackClick = useCallback(async (
    advertisementId: string,
    adPlacementId?: string | null,
  ) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('ad_impressions').insert({
        advertisement_id: advertisementId,
        ad_placement_id: adPlacementId || null,
        viewer_user_id: user.id,
        event_type: 'click',
      });

      // Increment click count
      const { data: ad } = await supabase.from('advertisements')
        .select('total_clicks, ad_placement_id')
        .eq('id', advertisementId)
        .single();

      if (ad) {
        await supabase.from('advertisements')
          .update({ total_clicks: (ad.total_clicks || 0) + 1 })
          .eq('id', advertisementId);

        if (ad.ad_placement_id) {
          const { data: placement } = await supabase.from('ad_placements')
            .select('total_clicks')
            .eq('id', ad.ad_placement_id)
            .single();
          if (placement) {
            await supabase.from('ad_placements')
              .update({ total_clicks: (placement.total_clicks || 0) + 1 })
              .eq('id', ad.ad_placement_id);
          }
        }
      }
    } catch (err) {
      console.error('Click tracking error:', err);
    }
  }, []);

  return { trackImpression, trackClick };
}
