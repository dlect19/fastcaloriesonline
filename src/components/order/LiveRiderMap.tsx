/// <reference types="google.maps" />
/**
 * Customer-only realtime map. Rider movement is animated locally from realtime GPS;
 * the road route comes from the throttled, cached server endpoint (never per GPS tick)
 * and is drawn from its returned geometry. There is never a direct-line fallback.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Home, Loader2, WifiOff, Clock, RefreshCw, Route as RouteIcon } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { loadGoogleMapsJs } from '@/lib/googleMapsLoader';
import { useTrackingConfig } from '@/hooks/useTrackingConfig';
import { interpolate, lastUpdatedLabel, liveState } from '@/lib/riderTracking';
import {
  decodePolyline, etaLabel, mapPoint, routeBackoffMs, shouldFitTrackingMap, shouldRefreshRoute,
  trackingDistanceLabel, trackingMarkerSvg, type MapPoint,
} from '@/lib/trackingMapVisuals';
import { MotorcycleIcon } from './MotorcycleIcon';

interface Props { orderId: string; destLat?: number | null; destLng?: number | null }
interface LivePoint { lat: number; lng: number; received_at: string }
interface RoadRoute { path: MapPoint[]; distanceM: number; durationS: number; at: number; originAt: string }
type RouteStatus = 'idle' | 'loading' | 'ok' | 'unavailable';
const PERMANENT = new Set(['not_in_transit', 'no_destination', 'order_not_found', 'invalid_order', 'stale_location', 'no_rider_location']);

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
  const seq = useRef(0);
  const appliedSeq = useRef(0);
  const inFlight = useRef(false);
  const lastRequestAt = useRef(0);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [point, setPoint] = useState<LivePoint | null>(null);
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routeStatus, setRouteStatus] = useState<RouteStatus>('idle');
  const [retryExhausted, setRetryExhausted] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [openedAt, setOpenedAt] = useState(Date.now());
  const destination = mapPoint(destLat, destLng);
  const rider = point ? mapPoint(point.lat, point.lng) : null;
  const state = liveState(rider ? point?.received_at ?? null : null, now, cfg, now - openedAt);

  useEffect(() => {
    let cancelled = false;
    setPoint(null); setRoute(null); setRouteStatus('idle'); setRetryExhausted(false);
    setOpenedAt(Date.now()); userMoved.current = false; fitted.current = null; failures.current = 0; lastRequestAt.current = 0;
    supabase.from('rider_live_locations' as any).select('lat, lng, received_at').eq('order_id', orderId).maybeSingle()
      .then(({ data }) => { if (!cancelled && data) setPoint(data as unknown as LivePoint); });
    const ch = supabase.channel(`rider-live-${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_live_locations', filter: `order_id=eq.${orderId}` },
        (payload) => {
          if (cancelled) return;
          if (payload.eventType === 'DELETE') { setPoint(null); setRoute(null); setRouteStatus('idle'); return; }
          const n = payload.new as LivePoint;
          // Ignore out-of-order realtime rows.
          setPoint((prev) => prev && new Date(prev.received_at) > new Date(n.received_at) ? prev : { lat: n.lat, lng: n.lng, received_at: n.received_at });
        })
      .subscribe();
    return () => {
      cancelled = true; supabase.removeChannel(ch);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      seq.current++; // invalidate responses for the previous order
    };
  }, [orderId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { fitted.current = null; setRoute(null); }, [destLat, destLng]);

  const requestRoute = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    lastRequestAt.current = Date.now();
    const mine = ++seq.current;
    setRouteStatus((s) => (s === 'ok' ? 'ok' : 'loading'));
    let reason = 'provider_error';
    try {
      const { data, error } = await supabase.functions.invoke('customer-rider-route', { body: { order_id: orderId } });
      if (mine !== seq.current || mine < appliedSeq.current) return; // superseded / stale response
      if (!error && data?.ok && typeof data.polyline === 'string') {
        const path = decodePolyline(data.polyline);
        if (path.length >= 2) {
          appliedSeq.current = mine; failures.current = 0; setRetryExhausted(false);
          setRoute((prev) => prev && data.origin_received_at && new Date(prev.originAt) > new Date(data.origin_received_at) ? prev
            : { path, distanceM: Number(data.distance_m), durationS: Number(data.duration_s), at: Date.now(), originAt: data.origin_received_at });
          setRouteStatus('ok');
          return;
        }
        reason = 'malformed';
      } else if (data?.reason) reason = data.reason;
    } catch { /* network */ } finally { inFlight.current = false; }
    if (mine !== seq.current) return;
    if (PERMANENT.has(reason)) { setRouteStatus(reason === 'stale_location' ? (route ? 'ok' : 'idle') : 'unavailable'); return; }
    setRoute(null); setRouteStatus('unavailable');
    failures.current += 1;
    const wait = routeBackoffMs(failures.current);
    if (wait === null) { setRetryExhausted(true); return; }
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => { retryTimer.current = null; void requestRoute(); }, wait);
  }, [orderId, route]);

  // Throttled refresh: initial, meaningful movement, route deviation, or age — never per GPS tick.
  useEffect(() => {
    if (!rider || !destination || state !== 'live' || retryTimer.current || retryExhausted || inFlight.current) return;
    if (shouldRefreshRoute({ rider, routeOrigin: route?.path[0] ?? null, path: route?.path ?? null, lastRequestAt: lastRequestAt.current, now: Date.now(), routeAt: route?.at ?? 0 })) {
      void requestRoute();
    }
  }, [point, destLat, destLng, state, now, route, retryExhausted, requestRoute]);

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

  const colours = () => {
    const css = getComputedStyle(rootEl.current!);
    return {
      green: css.getPropertyValue('--tracking-rider-color').trim(),
      orange: css.getPropertyValue('--tracking-delivery-color').trim(),
      ink: css.getPropertyValue('--tracking-marker-ink-color').trim(),
    };
  };

  // Road route geometry — redrawn only when a new route arrives.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !rootEl.current) return;
    if (!route || !destination) { lineRef.current?.setMap(null); lineRef.current = null; return; }
    const { orange } = colours();
    if (!lineRef.current) lineRef.current = new google.maps.Polyline({ map, clickable: false, strokeColor: orange, strokeOpacity: 0.95, strokeWeight: 5 });
    lineRef.current.setPath(route.path);
  }, [ready, route, destLat, destLng]);

  // Rider + destination markers; rider animation is independent of route refresh.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !rootEl.current) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const { green, orange, ink } = colours();
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
      markerRef.current?.setMap(null); markerRef.current = null; shownRef.current = null; fitted.current = null;
      if (destination && !userMoved.current) map.setCenter(destination);
      return;
    }
    if (!markerRef.current) {
      markerRef.current = new google.maps.Marker({ map, position: rider, title: 'Your delivery rider — motorcycle', icon: icon('rider', green), zIndex: 3 });
      shownRef.current = rider;
    }
    const from = shownRef.current ?? rider;
    const start = performance.now();
    const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 1200;
    const step = (ts: number) => {
      const p = duration ? interpolate(from, rider, (ts - start) / duration) : rider;
      markerRef.current?.setPosition(p); shownRef.current = p;
      if (ts - start < duration) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    const bounds = map.getBounds();
    const outside = !bounds || !bounds.contains(rider) || Boolean(destination && !bounds.contains(destination));
    if (shouldFitTrackingMap(fitted.current?.point ?? null, rider, Date.now() - (fitted.current?.at ?? 0), userMoved.current, outside)) {
      if (destination) {
        const b = new google.maps.LatLngBounds(); b.extend(rider); b.extend(destination);
        route?.path.forEach((pt) => b.extend(pt));
        map.fitBounds(b, { top: 64, bottom: 40, left: 48, right: 48 });
        google.maps.event.addListenerOnce(map, 'idle', () => {
          if (!userMoved.current && (map.getZoom() ?? 0) > 17) map.setZoom(17);
        });
      } else map.panTo(rider);
      fitted.current = { point: rider, at: Date.now() };
    }
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [ready, point, destLat, destLng]);

  const manualRetry = () => { failures.current = 0; setRetryExhausted(false); void requestRoute(); };
  const routed = rider && destination && route && routeStatus === 'ok';
  const roadDistance = routed ? trackingDistanceLabel(route.distanceM) : null;
  const eta = routed ? etaLabel(route.durationS) : null;
  const stale = state === 'stale';
  const routeUnavailable = rider && destination && routeStatus === 'unavailable' && !stale;

  return (
    <div ref={rootEl} className="tracking-map rounded-lg border border-border overflow-hidden bg-card">
      <div className="relative h-64 sm:h-72" onPointerDown={() => { userMoved.current = true; }} onWheel={() => { userMoved.current = true; }} onKeyDown={() => { userMoved.current = true; }}>
        <div ref={mapEl} role="region" aria-label={`Live delivery map${rider ? ': your rider on a motorcycle' : ': waiting for rider'}${destination ? ', You — delivery destination' : ''}${roadDistance ? `, road route ${roadDistance}` : ''}`} className="w-full h-full" />
        {mapError ? <div className="absolute inset-0 bg-card flex items-center justify-center text-sm text-muted-foreground p-4 text-center" role="alert">{mapError}</div>
          : !ready && <div className="absolute inset-0 bg-card flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />Loading map…</div>}
        {roadDistance && <div className="absolute top-3 left-3 tracking-rider-badge rounded-full px-3 py-1.5 shadow-sm pointer-events-none" role="status" aria-label={`${stale ? 'Last known' : 'Current'} road distance to delivery: ${roadDistance}, about ${eta}`}>
          <span className="font-bold text-base">{roadDistance}</span><span className="text-xs ml-2">{stale ? 'Last known route' : `by road · ~${eta}`}</span>
        </div>}
        {routeUnavailable && <div className="absolute top-3 left-3 right-3 sm:right-auto bg-card/95 border border-border rounded-full px-3 py-1.5 shadow-sm flex items-center gap-2 text-xs" role="status">
          <RouteIcon aria-hidden="true" className="w-4 h-4 shrink-0 text-muted-foreground" />
          <span>Route temporarily unavailable{retryExhausted ? '' : ' · retrying'}</span>
          {retryExhausted && <button type="button" onClick={manualRetry} className="text-primary font-medium flex items-center gap-1"><RefreshCw aria-hidden="true" className="w-3 h-3" />Retry</button>}
        </div>}
      </div>
      <div className="tracking-status-strip px-3 py-3 space-y-2 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium" aria-label="Map marker key">
          {rider && <span className="flex items-center gap-1.5 text-primary"><MotorcycleIcon className="w-4 h-4" />Your rider</span>}
          {destination && <span className="tracking-delivery-label flex items-center gap-1.5"><Home aria-hidden="true" className="w-4 h-4" />You · Delivery</span>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-start gap-2 min-w-0" role="status">
            {state === 'connecting' && <><Loader2 aria-hidden="true" className="w-4 h-4 shrink-0 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Connecting to rider location…</span></>}
            {state === 'live' && <><MotorcycleIcon className="w-4 h-4 shrink-0 text-primary" /><span>Live rider location{roadDistance ? ` · ${roadDistance} by road · ~${eta}` : ''}</span></>}
            {state === 'stale' && <><Clock aria-hidden="true" className="w-4 h-4 shrink-0 text-muted-foreground" /><span className="text-muted-foreground">Rider location not updated recently</span></>}
            {state === 'waiting' && <><WifiOff aria-hidden="true" className="w-4 h-4 shrink-0 text-muted-foreground" /><span className="text-muted-foreground">Waiting for rider to enable location. This updates automatically.</span></>}
          </div>
          {rider && point && <span className="text-xs text-muted-foreground">Last updated {lastUpdatedLabel(point.received_at, now)}</span>}
        </div>
      </div>
    </div>
  );
}
