/// <reference types="google.maps" />
/**
 * Customer live rider map for their own active delivery. The map is loaded
 * once; each location update only moves the marker (smoothly). No Google
 * Directions/Routes/Distance Matrix calls are made from here.
 */
import { useEffect, useRef, useState } from 'react';
import { Bike, Loader2, WifiOff, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { loadGoogleMapsJs } from '@/lib/googleMapsLoader';
import { useTrackingConfig } from '@/hooks/useTrackingConfig';
import { distanceM, interpolate, lastUpdatedLabel, liveState } from '@/lib/riderTracking';

interface Props {
  orderId: string;
  destLat?: number | null;
  destLng?: number | null;
}

interface LivePoint { lat: number; lng: number; received_at: string }

export function LiveRiderMap({ orderId, destLat, destLng }: Props) {
  const cfg = useTrackingConfig();
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const shownRef = useRef<{ lat: number; lng: number } | null>(null);
  const rafRef = useRef<number | null>(null);
  const [point, setPoint] = useState<LivePoint | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [openedAt] = useState(Date.now());

  // Latest authorised location (RLS: own active order only) + realtime updates.
  useEffect(() => {
    let cancelled = false;
    supabase.from('rider_live_locations' as any).select('lat, lng, received_at').eq('order_id', orderId).maybeSingle()
      .then(({ data }) => { if (!cancelled && data) setPoint(data as any); });
    const ch = supabase.channel(`rider-live-${orderId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rider_live_locations', filter: `order_id=eq.${orderId}` },
        (payload) => {
          if (payload.eventType === 'DELETE') { setPoint(null); return; }
          const n = payload.new as any;
          setPoint({ lat: n.lat, lng: n.lng, received_at: n.received_at });
        })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [orderId]);

  // One ticker for "last updated" / stale state.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  // Map loaded once.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMapsJs().then(() => {
      if (cancelled || !mapEl.current || mapRef.current) return;
      const center = destLat && destLng ? { lat: destLat, lng: destLng } : { lat: 6.5244, lng: 3.3792 };
      mapRef.current = new google.maps.Map(mapEl.current, {
        center, zoom: 14, clickableIcons: false, disableDefaultUI: true, zoomControl: true,
      });
      if (destLat && destLng) new google.maps.Marker({ position: center, map: mapRef.current, title: 'Delivery address' });
    }).catch((e) => { if (!cancelled) setMapError((e as Error).message || 'Map unavailable'); });
    return () => { cancelled = true; if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [destLat, destLng]);

  // Animate the rider marker to each new point.
  useEffect(() => {
    if (!point || !mapRef.current) return;
    const target = { lat: point.lat, lng: point.lng };
    if (!markerRef.current) {
      markerRef.current = new google.maps.Marker({
        position: target, map: mapRef.current, title: 'Your rider',
        icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: '#16a34a', fillOpacity: 1, strokeColor: '#ffffff', strokeWeight: 2 },
      });
      shownRef.current = target;
      mapRef.current.panTo(target);
      return;
    }
    const from = shownRef.current ?? target;
    const start = performance.now();
    const dur = 1200;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const step = (ts: number) => {
      const p = interpolate(from, target, (ts - start) / dur);
      markerRef.current?.setPosition(p);
      shownRef.current = p;
      if (ts - start < dur) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    const b = mapRef.current.getBounds();
    if (b && !b.contains(target)) mapRef.current.panTo(target);
  }, [point, mapError]);

  const state = liveState(point?.received_at ?? null, now, cfg, now - openedAt);
  const km = point && destLat && destLng ? distanceM(point, { lat: destLat, lng: destLng }) / 1000 : null;

  return (
    <div className="rounded-xl border border-border overflow-hidden bg-card">
      <div className="relative h-56">
        {mapError ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground p-4 text-center">{mapError}</div>
        ) : (
          <div ref={mapEl} className="w-full h-full" />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          {state === 'connecting' && <><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Connecting to rider location…</span></>}
          {state === 'live' && <><Bike className="w-4 h-4 text-primary" /><span className="text-foreground">Live rider location{km !== null ? ` · ${km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`} away` : ''}</span></>}
          {state === 'stale' && <><Clock className="w-4 h-4 text-muted-foreground" /><span className="text-muted-foreground">Rider location not updated recently</span></>}
          {state === 'waiting' && <><WifiOff className="w-4 h-4 text-muted-foreground" /><span className="text-muted-foreground">Waiting for rider to enable location. This updates automatically.</span></>}
        </div>
        {point && <span className="text-xs text-muted-foreground whitespace-nowrap">Last updated {lastUpdatedLabel(point.received_at, now)}</span>}
      </div>
    </div>
  );
}
