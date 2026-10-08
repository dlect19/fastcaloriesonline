/// <reference types="google.maps" />
/**
 * Customer-only realtime map. Rider movement is animated locally between actual accepted GPS
 * fixes (never extrapolated); the road route comes from the throttled, cached server endpoint
 * (never per GPS tick) and is drawn from its returned geometry, trimmed locally as the rider
 * progresses along it. There is never a direct-line fallback or a connector drawn off-road.
 * Realtime has bounded resubscribe + fallback polling + visibility resync; every source of a
 * location row goes through newerLocation() so an older row never overwrites a newer one.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Home, Loader2, WifiOff, Clock, RefreshCw, Route as RouteIcon, LocateFixed } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { loadGoogleMapsJs } from '@/lib/googleMapsLoader';
import { useTrackingConfig } from '@/hooks/useTrackingConfig';
import { interpolate, lastUpdatedLabel, liveState } from '@/lib/riderTracking';
import {
  chooseRiderHeading, decodePolyline, etaLabel, mapPoint, newerLocation, POLL_INTERVAL_MS, quantizeHeading,
  remainingRoute, resubscribeDelayMs, routeBackoffMs, shouldFitTrackingMap, shouldPoll, shouldRefreshRoute,
  trackingDistanceLabel, trackingMarkerSvg, type MapPoint,
} from '@/lib/trackingMapVisuals';
import { MotorcycleIcon } from './MotorcycleIcon';

interface Props { orderId: string; destLat?: number | null; destLng?: number | null }
interface LivePoint { lat: number; lng: number; received_at: string; heading?: number | null; speed_mps?: number | null; accuracy_m?: number | null }
interface RoadRoute { path: MapPoint[]; distanceM: number; durationS: number; at: number; originAt: string; origin: MapPoint }
type RouteStatus = 'idle' | 'loading' | 'ok' | 'unavailable';
const PERMANENT = new Set(['not_in_transit', 'no_destination', 'order_not_found', 'invalid_order', 'stale_location', 'no_rider_location']);
const COLUMNS = 'lat, lng, received_at, heading, speed_mps, accuracy_m';
// Top padding clears the distance badge so it never covers a marker.
const FIT_PADDING = { top: 84, bottom: 44, left: 44, right: 44 };

export function LiveRiderMap({ orderId, destLat, destLng }: Props) {
  const cfg = useTrackingConfig();
  const rootEl = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const deliveryRef = useRef<google.maps.Marker | null>(null);
  const lineRef = useRef<google.maps.Polyline | null>(null);
  const shownRef = useRef<MapPoint | null>(null);
  const headingRef = useRef<number | null>(null);
  const prevFixRef = useRef<MapPoint | null>(null);
  const iconKeyRef = useRef('');
  const rafRef = useRef<number | null>(null);
  const userMoved = useRef(false);
  const fitted = useRef<{ point: MapPoint; at: number } | null>(null);
  const fittedRouteAt = useRef(0);
  const seq = useRef(0);
  const appliedSeq = useRef(0);
  const inFlight = useRef(false);
  const lastRequestAt = useRef(0);
  const failures = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointRef = useRef<LivePoint | null>(null);
  const [point, setPointState] = useState<LivePoint | null>(null);
  const [route, setRoute] = useState<RoadRoute | null>(null);
  const [routeStatus, setRouteStatus] = useState<RouteStatus>('idle');
  const [retryExhausted, setRetryExhausted] = useState(false);
  const [mapError, setMapError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [openedAt, setOpenedAt] = useState(Date.now());
  const [channelUp, setChannelUp] = useState(false);
  const [feedGaveUp, setFeedGaveUp] = useState(false);
  const [showRecenter, setShowRecenter] = useState(false);
  const [resyncNonce, setResyncNonce] = useState(0);
  const destination = mapPoint(destLat, destLng);
  const rider = point ? mapPoint(point.lat, point.lng) : null;
  const state = liveState(rider ? point?.received_at ?? null : null, now, cfg, now - openedAt);

  /** Single entry point for every location source: only newer rows win. */
  const offerPoint = useCallback((row: LivePoint | null) => {
    if (!row) return;
    const next = newerLocation(pointRef.current, row);
    if (next !== pointRef.current) { pointRef.current = next; setPointState(next); }
  }, []);
  const clearPoint = () => { pointRef.current = null; setPointState(null); };

  // Realtime feed with bounded resubscribe, fallback polling and visibility/network resync.
  useEffect(() => {
    let cancelled = false;
    let ch: ReturnType<typeof supabase.channel> | null = null;
    let attempts = 0;
    let resubTimer: ReturnType<typeof setTimeout> | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let polls = 0;
    let up = false;
    clearPoint(); setRoute(null); setRouteStatus('idle'); setRetryExhausted(false); setFeedGaveUp(false);
    setOpenedAt(Date.now()); userMoved.current = false; fitted.current = null; failures.current = 0; lastRequestAt.current = 0;
    headingRef.current = null; prevFixRef.current = null;

    const fetchLatest = async () => {
      const { data } = await supabase.from('rider_live_locations' as any).select(COLUMNS).eq('order_id', orderId).maybeSingle();
      if (!cancelled && data) offerPoint(data as unknown as LivePoint);
    };
    const subscribe = () => {
      if (cancelled) return;
      if (ch) { void supabase.removeChannel(ch); ch = null; }
      const channel = supabase.channel(`rider-live-${orderId}-${Date.now()}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_live_locations', filter: `order_id=eq.${orderId}` },
          (payload) => {
            if (cancelled) return;
            if (payload.eventType === 'DELETE') { clearPoint(); setRoute(null); setRouteStatus('idle'); return; }
            const n = payload.new as LivePoint;
            offerPoint({ lat: n.lat, lng: n.lng, received_at: n.received_at, heading: n.heading, speed_mps: n.speed_mps, accuracy_m: n.accuracy_m });
          });
      ch = channel;
      channel.subscribe((status?: string) => {
        if (cancelled || ch !== channel) return;
        if (status === 'SUBSCRIBED') {
          const wasDown = !up; up = true; attempts = 0; polls = 0; setChannelUp(true); setFeedGaveUp(false);
          if (wasDown) void fetchLatest(); // catch up anything missed while disconnected
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          up = false; setChannelUp(false);
          if (resubTimer) return;
          const wait = resubscribeDelayMs(++attempts);
          if (wait === null) return; // polling still covers this; visibility resume retries
          resubTimer = setTimeout(() => { resubTimer = null; subscribe(); }, wait);
        }
      });
    };
    void fetchLatest(); subscribe();

    pollTimer = setInterval(() => {
      if (cancelled || document.visibilityState === 'hidden') return;
      if (!shouldPoll({ channelUp: up, lastReceivedAt: pointRef.current?.received_at ?? null, now: Date.now(), movingIntervalS: cfg.movingIntervalS, polls })) {
        if (polls >= 80) setFeedGaveUp(true);
        return;
      }
      polls++; void fetchLatest();
    }, POLL_INTERVAL_MS);

    const resume = () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      polls = 0; setFeedGaveUp(false); setNow(Date.now()); void fetchLatest();
      if (!up && !resubTimer) { attempts = 0; subscribe(); }
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('focus', resume);
    return () => {
      cancelled = true;
      if (ch) void supabase.removeChannel(ch);
      if (resubTimer) clearTimeout(resubTimer);
      if (pollTimer) clearInterval(pollTimer);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('online', resume);
      window.removeEventListener('focus', resume);
      seq.current++; // invalidate responses for the previous order
    };
  }, [orderId, resyncNonce, offerPoint, cfg.movingIntervalS]);

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
          const origin = mapPoint(Number(data.origin_lat), Number(data.origin_lng)) ?? path[0];
          setRoute((prev) => prev && data.origin_received_at && new Date(prev.originAt) > new Date(data.origin_received_at) ? prev
            : { path, distanceM: Number(data.distance_m), durationS: Number(data.duration_s), at: Date.now(), originAt: data.origin_received_at, origin });
          setRouteStatus('ok');
          return;
        }
        reason = 'malformed';
      } else if (data?.reason) reason = data.reason;
    } catch { /* network */ } finally { inFlight.current = false; }
    if (mine !== seq.current) return;
    if (PERMANENT.has(reason)) { setRouteStatus((s) => reason === 'stale_location' ? (s === 'ok' ? 'ok' : 'idle') : 'unavailable'); return; }
    setRoute(null); setRouteStatus('unavailable');
    failures.current += 1;
    const wait = routeBackoffMs(failures.current);
    if (wait === null) { setRetryExhausted(true); return; }
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = setTimeout(() => { retryTimer.current = null; void requestRoute(); }, wait);
  }, [orderId]);

  // Throttled refresh: initial, meaningful movement (~45 m), route deviation, or age — never per GPS tick.
  useEffect(() => {
    if (!rider || !destination || state !== 'live' || retryTimer.current || retryExhausted || inFlight.current) return;
    if (shouldRefreshRoute({ rider, routeOrigin: route?.origin ?? null, path: route?.path ?? null, lastRequestAt: lastRequestAt.current, now: Date.now(), routeAt: route?.at ?? 0 })) {
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

  const remaining = route && routeStatus === 'ok' ? remainingRoute(route, rider, point?.accuracy_m) : null;

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || !rider) return;
    if (!destination) { map.panTo(rider); return; }
    const b = new google.maps.LatLngBounds(); b.extend(rider); b.extend(destination);
    (remaining?.path ?? []).forEach((pt) => b.extend(pt));
    map.fitBounds(b, FIT_PADDING);
    google.maps.event.addListenerOnce(map, 'idle', () => { if ((map.getZoom() ?? 0) > 17) map.setZoom(17); });
  }, [rider, destination, remaining]);

  // Road route geometry: remaining (trimmed) provider path only.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !rootEl.current) return;
    if (!remaining || !destination) { lineRef.current?.setMap(null); lineRef.current = null; return; }
    const { orange } = colours();
    if (!lineRef.current) lineRef.current = new google.maps.Polyline({ map, clickable: false, strokeColor: orange, strokeOpacity: 0.95, strokeWeight: 5 });
    lineRef.current.setPath(remaining.path);
    // Fit once per newly received route, unless the customer has taken over the camera.
    if (route && route.at !== fittedRouteAt.current) {
      fittedRouteAt.current = route.at;
      if (!userMoved.current) { fitAll(); fitted.current = rider ? { point: rider, at: Date.now() } : fitted.current; }
    }
  }, [ready, route, point, destLat, destLng]);

  // Rider + destination markers; animation runs per actual accepted fix, independent of routing.
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !rootEl.current) return;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    const { green, orange, ink } = colours();
    if (destination) {
      if (!deliveryRef.current) deliveryRef.current = new google.maps.Marker({
        map, position: destination, title: 'You — delivery destination', zIndex: 2,
        icon: { url: trackingMarkerSvg('delivery', orange, ink), scaledSize: new google.maps.Size(44, 44), anchor: new google.maps.Point(22, 43) },
      });
      deliveryRef.current.setPosition(destination);
    } else { deliveryRef.current?.setMap(null); deliveryRef.current = null; }
    if (!rider) {
      markerRef.current?.setMap(null); markerRef.current = null; shownRef.current = null; fitted.current = null;
      if (destination && !userMoved.current) map.setCenter(destination);
      return;
    }
    headingRef.current = chooseRiderHeading({ previous: headingRef.current, prevPoint: prevFixRef.current, next: rider, gpsHeading: point?.heading, speedMps: point?.speed_mps, accuracyM: point?.accuracy_m });
    prevFixRef.current = rider;
    const h = headingRef.current ?? 0;
    const iconKey = `${quantizeHeading(h)}|${green}|${ink}`;
    const riderIcon: google.maps.Icon = { url: trackingMarkerSvg('rider', green, ink, h), scaledSize: new google.maps.Size(52, 52), anchor: new google.maps.Point(26, 26) };
    if (!markerRef.current) {
      markerRef.current = new google.maps.Marker({ map, position: rider, title: 'Your delivery rider on a motorcycle', icon: riderIcon, zIndex: 3 });
      shownRef.current = rider; iconKeyRef.current = iconKey;
    } else if (iconKeyRef.current !== iconKey) { markerRef.current.setIcon(riderIcon); iconKeyRef.current = iconKey; }
    const from = shownRef.current ?? rider;
    const start = performance.now();
    const duration = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 1200;
    const step = (ts: number) => {
      const p = duration ? interpolate(from, rider, (ts - start) / duration) : rider;
      markerRef.current?.setPosition(p); shownRef.current = p;
      if (ts - start < duration) rafRef.current = requestAnimationFrame(step); // stops exactly at the real fix
    };
    rafRef.current = requestAnimationFrame(step);
    const bounds = map.getBounds();
    const outside = !bounds || !bounds.contains(rider) || Boolean(destination && !bounds.contains(destination));
    if (shouldFitTrackingMap(fitted.current?.point ?? null, rider, Date.now() - (fitted.current?.at ?? 0), userMoved.current, outside)) {
      fitAll();
      fitted.current = { point: rider, at: Date.now() };
    }
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, [ready, point, destLat, destLng]);

  const onUserCamera = () => { userMoved.current = true; setShowRecenter(true); };
  const recenter = () => { userMoved.current = false; setShowRecenter(false); fitAll(); if (rider) fitted.current = { point: rider, at: Date.now() }; };
  const manualRetry = () => { failures.current = 0; setRetryExhausted(false); void requestRoute(); };
  const routed = rider && destination && remaining;
  const roadDistance = routed ? trackingDistanceLabel(remaining.distanceM) : null;
  const eta = routed ? etaLabel(remaining.durationS) : null;
  const estimated = Boolean(remaining?.estimated);
  const stale = state === 'stale';
  const routeUnavailable = rider && destination && routeStatus === 'unavailable' && !stale;
  const feedDown = !channelUp && Boolean(rider) && !stale;

  return (
    <div ref={rootEl} className="tracking-map rounded-lg border border-border overflow-hidden bg-card">
      <div className="relative h-64 sm:h-72" onPointerDown={onUserCamera} onWheel={onUserCamera} onKeyDown={onUserCamera}>
        <div ref={mapEl} role="region" aria-label={`Live delivery map${rider ? ': your rider on a motorcycle' : ': waiting for rider'}${destination ? ', You — delivery destination' : ''}${roadDistance ? `, road route ${roadDistance}` : ''}`} className="w-full h-full" />
        {mapError ? <div className="absolute inset-0 bg-card flex items-center justify-center text-sm text-muted-foreground p-4 text-center" role="alert">{mapError}</div>
          : !ready && <div className="absolute inset-0 bg-card flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 aria-hidden="true" className="w-4 h-4 animate-spin" />Loading map…</div>}
        {roadDistance && <div className="absolute top-2 left-2 tracking-rider-badge rounded-full px-3 py-1 shadow-sm pointer-events-none" role="status" aria-label={`${stale ? 'Last known' : estimated ? 'Estimated remaining' : 'Current'} road distance to delivery: ${roadDistance}, about ${eta}`}>
          <span className="font-bold text-sm">{roadDistance}</span><span className="text-xs ml-2">{stale ? 'Last known route' : `${estimated ? 'left · est.' : 'by road'} ~${eta}`}</span>
        </div>}
        {routeUnavailable && <div className="absolute top-2 left-2 right-2 sm:right-auto bg-card/95 border border-border rounded-full px-3 py-1.5 shadow-sm flex items-center gap-2 text-xs" role="status">
          <RouteIcon aria-hidden="true" className="w-4 h-4 shrink-0 text-muted-foreground" />
          <span>Route temporarily unavailable{retryExhausted ? '' : ' · retrying'}</span>
          {retryExhausted && <button type="button" onClick={manualRetry} className="text-primary font-medium flex items-center gap-1"><RefreshCw aria-hidden="true" className="w-3 h-3" />Retry</button>}
        </div>}
        {showRecenter && rider && <button type="button" onClick={recenter} aria-label="Recenter map on rider and delivery" className="absolute bottom-3 left-3 bg-card border border-border rounded-full px-3 py-1.5 shadow-sm flex items-center gap-1.5 text-xs font-medium text-foreground">
          <LocateFixed aria-hidden="true" className="w-4 h-4 text-primary" />Recenter
        </button>}
      </div>
      <div className="tracking-status-strip px-3 py-3 space-y-2 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-medium" aria-label="Map marker key">
          {rider && <span className="flex items-center gap-1.5 text-primary"><MotorcycleIcon className="w-4 h-4" />Your rider</span>}
          {destination && <span className="tracking-delivery-label flex items-center gap-1.5"><Home aria-hidden="true" className="w-4 h-4" />You · Delivery</span>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <div className="flex items-start gap-2 min-w-0" role="status">
            {state === 'connecting' && <><Loader2 aria-hidden="true" className="w-4 h-4 shrink-0 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Connecting to rider location…</span></>}
            {state === 'live' && <><MotorcycleIcon className="w-4 h-4 shrink-0 text-primary" /><span>Live rider location{roadDistance ? ` · ${roadDistance} ${estimated ? 'left (est.)' : 'by road'} · ~${eta}` : ''}</span></>}
            {state === 'stale' && <><Clock aria-hidden="true" className="w-4 h-4 shrink-0 text-muted-foreground" /><span className="text-muted-foreground">Rider location not updated recently</span></>}
            {state === 'waiting' && <><WifiOff aria-hidden="true" className="w-4 h-4 shrink-0 text-muted-foreground" /><span className="text-muted-foreground">Waiting for rider to enable location. This updates automatically.</span></>}
          </div>
          {rider && point && <span className="text-xs text-muted-foreground">Last updated {lastUpdatedLabel(point.received_at, now)}</span>}
        </div>
        {feedDown && <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <WifiOff aria-hidden="true" className="w-3.5 h-3.5 shrink-0" />
          <span>{feedGaveUp ? 'Live updates paused.' : 'Reconnecting live updates · checking every 15s'}</span>
          {feedGaveUp && <button type="button" className="text-primary font-medium" onClick={() => setResyncNonce((n) => n + 1)}>Resume</button>}
        </div>}
      </div>
    </div>
  );
}
