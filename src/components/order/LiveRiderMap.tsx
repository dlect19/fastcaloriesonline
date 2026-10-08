/// <reference types="google.maps" />
/** Customer-only realtime map. All overlays and distances are computed locally. */
import { useEffect, useRef, useState } from 'react';
import { Bike, Home, Loader2, WifiOff, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { loadGoogleMapsJs } from '@/lib/googleMapsLoader';
import { useTrackingConfig } from '@/hooks/useTrackingConfig';
import { distanceM, interpolate, lastUpdatedLabel, liveState } from '@/lib/riderTracking';
import { mapPoint, trackingDistanceLabel, trackingMarkerSvg, shouldFitTrackingMap, type MapPoint } from '@/lib/trackingMapVisuals';

interface Props { orderId: string; destLat?: number | null; destLng?: number | null }
interface LivePoint { lat: number; lng: number; received_at: string }

export function LiveRiderMap({ orderId, destLat, destLng }: Props) {
  const cfg = useTrackingConfig();
  const rootEl = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const deliveryRef = useRef<google.maps.Marker | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const shownRef = useRef<MapPoint | null>(null);
  const rafRef = useRef<number | null>(null);
  const userMoved = useRef(false);
  const fitted = useRef<{ point: MapPoint; at: number } | null>(null);
  const [point, setPoint] = useState<LivePoint | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [openedAt, setOpenedAt] = useState(Date.now());
  const destination = mapPoint(destLat, destLng);
  const rider = point ? mapPoint(point.lat, point.lng) : null;

  useEffect(() => {
    let cancelled = false;
    setPoint(null); setOpenedAt(Date.now()); userMoved.current = false; fitted.current = null;
    supabase.from('rider_live_locations' as any).select('lat, lng, received_at').eq('order_id', orderId).maybeSingle()
      .then(({ data }) => { if (!cancelled && data) setPoint(data as unknown as LivePoint); });
    const ch = supabase.channel(`rider-live-${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_live_locations', filter: `order_id=eq.${orderId}` },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') { setPoint(null); return; }
          const n = payload.new as LivePoint;
          setPoint({ lat: n.lat, lng: n.lng, received_at: n.received_at });
        })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [orderId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsJs().then(() => {
      if (cancelled || !mapEl.current || mapRef.current) return;
      mapRef.current = new google.maps.Map(mapEl.current, {
        center: { lat: 6.5244, lng: 3.3792 }, zoom: 14,
        clickableIcons: false, disableDefaultUI: true, zoomControl: true,
      });
      setReady(true);
    }).catch((e: unknown) => { if (!cancelled) setMapError(e instanceof Error ? e.message : 'Map unavailable'); });
    return () => {
      cancelled = true;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      markerRef.current?.setMap(null); deliveryRef.current?.setMap(null); lineRef.current?.setMap(null);
      markerRef.current = null; deliveryRef.current = null; lineRef.current = null; shownRef.current = null;
      if (mapRef.current) google.maps.event.clearInstanceListeners(mapRef.current);
      mapRef.current = null;
    };
  }, []);

  // Ready is state, so an initial point received before Maps loads is not lost.
  useEffect(() => {
    const map = mapRef.current;
    const root = rootEl.current;
    if (!ready || !map || !root) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const css = getComputedStyle(root);
    const green = css.getPropertyValue('--tracking-rider-color').trim();
    const orange = css.getPropertyValue('--tracking-delivery-color').trim();
    const ink = css.getPropertyValue('--tracking-marker-ink-color').trim();
    const icon = (kind: 'rider' | 'delivery', colour: string): google.maps.Icon => ({
      url: trackingMarkerSvg(kind, colour, ink), scaledSize: new google.maps.Size(48, 48), anchor: new google.maps.Point(24, 47),
    });
    if (destination) {
      if (!deliveryRef.current) deliveryRef.current = new google.maps.Marker({
        map, position: destination, title: 'You — delivery destination', icon: icon('delivery', orange), zIndex: 2,
      });
      deliveryRef.current.setPosition(destination);
    } else { deliveryRef.current?.setMap(null); deliveryRef.current = null; }
    if (!rider) {
      markerRef.current?.setMap(null); markerRef.current = null; shownRef.current = null;
      lineRef.current?.setMap(null); lineRef.current = null; fitted.current = null;
      if (destination && !userMoved.current) map.setCenter(destination);
      return;
    }
    if (!markerRef.current) {
      markerRef.current = new google.maps.Marker({ map, position: rider, title: 'Your delivery rider — motorcycle', icon: icon('rider', green), zIndex: 3 });
      shownRef.current = rider;
    }
    if (destination) {
      if (!lineRef.current) lineRef.current = new google.maps.Polyline({
        map, clickable: false, strokeColor: green, strokeOpacity: 0.9, strokeWeight: 4, geodesic: true,
      });
      lineRef.current.setPath([shownRef.current ?? rider, destination]);
    } else { lineRef.current?.setMap(null); lineRef.current = null; }
    const from = shownRef.current ?? rider;
    const start = performance.now();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const duration = reducedMotion ? 0 : 1200;
    const step = (ts: number) => {
      const p = duration ? interpolate(from, rider, (ts - start) / duration) : rider;
      markerRef.current?.setPosition(p); shownRef.current = p;
      if (destination) lineRef.current?.setPath([p, destination]);
      if (ts - start < duration) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    const bounds = map.getBounds();
    const outside = !bounds || !bounds.contains(rider) || Boolean(destination && !bounds.contains(destination));
    if (shouldFitTrackingMap(fitted.current?.point ?? null, rider, Date.now() - (fitted.current?.at ?? 0), userMoved.current, outside)) {
      if (destination) {
        const b = new google.maps.LatLngBounds(); b.extend(rider); b.extend(destination);
        map.fitBounds(b, { top: 64, bottom: 40, left: 48, right: 48 });
        google.maps.event.addListenerOnce(map, 'idle', () => {
          if (!userMoved.current && (map.getZoom() ?? 0) > 17) map.setZoom(17);
        });
      } else map.panTo(rider);
      fitted.current = { point: rider, at: Date.now() };
    }
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [ready, point, destLat, destLng]);

  const state = liveState(rider ? point?.received_at ?? null : null, now, cfg, now - openedAt);
  const distance = rider && destination ? trackingDistanceLabel(distanceM(rider, destination)) : null;
  return (
    <div ref={rootEl} className="tracking-map rounded-lg border border-border overflow-hidden bg-card">
      <div className="relative h-64 sm:h-72" onPointerDown={() => { userMoved.current = true; }} onWheel={() => { userMoved.current = true; }} onKeyDown={() => { userMoved.current = true; }}>
        <div ref={mapEl} role="region" aria-label="Live delivery map: rider motorcycle and your delivery destination" className="w-full h-full" />
        {mapError ? <div className="absolute inset-0 bg-card flex items-center justify-center text-sm text-muted-foreground p-4 text-center" role="alert">{mapError}</div>
          : !ready && <div className="absolute inset-0 bg-card flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />Loading map…</div>}
        {distance && <div className="absolute top-3 left-3 tracking-rider-badge rounded-full px-3 py-1.5 shadow-sm pointer-events-none" role="status" aria-label={`${state === 'stale' ? 'Last known' : 'Current'} direct distance to delivery: ${distance}`}>
          <span className="font-bold text-base">{distance}</span><span className="text-xs ml-2">{state === 'stale' ? 'Last known · direct' : 'Direct distance'}</span>
        </div>}
      </div>
      <div className="tracking-status-strip px-3 py-3 space-y-2 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium" aria-label="Map marker key">
          {rider && <span className="flex items-center gap-1.5 text-primary"><Bike aria-hidden="true" className="w-4 h-4" />Your rider</span>}
          {destination && <span className="tracking-delivery-label flex items-center gap-1.5"><Home aria-hidden="true" className="w-4 h-4" />You · Delivery</span>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-start gap-2 min-w-0" role="status">
            {state === 'connecting' && <><Loader2 aria-hidden="true" className="w-4 h-4 shrink-0 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Connecting to rider location…</span></>}
            {state === 'live' && <><Bike aria-hidden="true" className="w-4 h-4 shrink-0 text-primary" /><span>Live rider location{distance ? ` · ${distance} away (direct)` : ''}</span></>}
            {state === 'stale' && <><Clock aria-hidden="true" className="w-4 h-4 shrink-0 text-muted-foreground" /><span className="text-muted-foreground">Rider location not updated recently</span></>}
            {state === 'waiting' && <><WifiOff aria-hidden="true" className="w-4 h-4 shrink-0 text-muted-foreground" /><span className="text-muted-foreground">Waiting for rider to enable location. This updates automatically.</span></>}
          </div>
          {rider && point && <span className="text-xs text-muted-foreground">Last updated {lastUpdatedLabel(point.received_at, now)}</span>}
        </div>
      </div>
    </div>
  );
}
