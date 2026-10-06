/**
 * Publishes the rider's location only while they are assigned to an active
 * delivery (assigned → picked_up → on_the_way). Foreground only: the watcher
 * runs while the rider app is open; it is stopped on delivery, cancellation,
 * reassignment, kill switch, logout/unmount or when no active delivery exists.
 */
import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { supabase } from '@/integrations/supabase/client';
import { useTrackingConfig } from '@/hooks/useTrackingConfig';
import {
  ACTIVE_TRACKING_STATUSES, isMoving, isUsableFix, LatestOnlyBuffer, shouldPublish, type Fix,
} from '@/lib/riderTracking';

export type RiderTrackingStatus = 'idle' | 'tracking' | 'permission_denied' | 'gps_unavailable' | 'disabled';

const ORDER_POLL_MS = 60_000;

export function useRiderLiveTracking(riderUserId: string | null | undefined) {
  const cfg = useTrackingConfig();
  const [status, setStatus] = useState<RiderTrackingStatus>('idle');
  const [orders, setOrders] = useState<{ id: string; status: string }[]>([]);
  const [highAccuracy, setHighAccuracy] = useState(true);
  const lastSentRef = useRef<Fix | null>(null);
  const lastFixRef = useRef<Fix | null>(null);
  const forceRef = useRef(false);
  const stillSinceRef = useRef<number | null>(null);
  const bufferRef = useRef(new LatestOnlyBuffer());
  const ordersRef = useRef(orders);
  ordersRef.current = orders;

  // Active deliveries for this rider (server RLS: rider sees own orders).
  useEffect(() => {
    if (!riderUserId || !cfg.enabled) { setOrders([]); return; }
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from('orders').select('id, status')
        .eq('rider_id', riderUserId).eq('delivery_type', 'delivery')
        .in('status', [...ACTIVE_TRACKING_STATUSES]).limit(5);
      if (cancelled) return;
      const next = (data || []) as { id: string; status: string }[];
      const prevKey = ordersRef.current.map((o) => `${o.id}:${o.status}`).join(',');
      const nextKey = next.map((o) => `${o.id}:${o.status}`).join(',');
      if (prevKey !== nextKey) { forceRef.current = true; setOrders(next); }
    };
    load();
    const t = setInterval(load, ORDER_POLL_MS);
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { cancelled = true; clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [riderUserId, cfg.enabled]);

  const active = cfg.enabled && !!riderUserId && orders.length > 0;

  useEffect(() => {
    if (!cfg.enabled) setStatus('disabled');
    else if (!active) setStatus('idle');
  }, [active, cfg.enabled]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let watchId: string | number | null = null;
    const native = Capacitor.isNativePlatform();

    const send = async (fix: Fix) => {
      if (!navigator.onLine) { bufferRef.current.set(fix); return; }
      lastSentRef.current = fix;
      forceRef.current = false;
      for (const o of ordersRef.current) {
        const { data, error } = await supabase.rpc('publish_rider_location' as any, {
          p_order_id: o.id, p_lat: fix.lat, p_lng: fix.lng,
          p_accuracy: fix.accuracy ?? null, p_heading: fix.heading ?? null, p_speed: fix.speed ?? null,
          p_captured_at: new Date(fix.capturedAt).toISOString(),
        });
        if (error) { bufferRef.current.set(fix); continue; }
        const r = data as { ok: boolean; stop?: boolean } | null;
        if (r?.stop) setOrders((cur) => cur.filter((x) => x.id !== o.id));
      }
    };

    const onFix = (fix: Fix) => {
      if (stopped) return;
      const now = Date.now();
      if (!isUsableFix(fix, now)) return;
      const moving = isMoving(lastFixRef.current, fix);
      lastFixRef.current = fix;
      setStatus('tracking');
      // Back off to low-power GPS after 2 minutes stationary; restore when moving.
      if (moving) { stillSinceRef.current = null; if (!highAccuracy) setHighAccuracy(true); }
      else {
        stillSinceRef.current ??= now;
        if (highAccuracy && now - stillSinceRef.current > 120_000) setHighAccuracy(false);
      }
      if (shouldPublish(lastSentRef.current, fix, now, cfg, { force: forceRef.current, moving })) void send(fix);
    };

    const onError = (code?: number) => {
      if (code === 1) setStatus('permission_denied');
      else setStatus('gps_unavailable');
    };

    const toFix = (p: any): Fix => ({
      lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy,
      speed: p.coords.speed, heading: p.coords.heading, capturedAt: p.timestamp || Date.now(),
    });
    const opts = { enableHighAccuracy: highAccuracy, maximumAge: 5000, timeout: 20000 };

    (async () => {
      try {
        if (native) {
          const id = await Geolocation.watchPosition(opts, (pos, err) => {
            if (err) { onError(String(err?.message || '').toLowerCase().includes('denied') ? 1 : 2); return; }
            if (pos) onFix(toFix(pos));
          });
          if (stopped) Geolocation.clearWatch({ id }); else watchId = id;
        } else if ('geolocation' in navigator) {
          watchId = navigator.geolocation.watchPosition((p) => onFix(toFix(p)), (e) => onError(e.code), opts);
        } else {
          setStatus('gps_unavailable');
        }
      } catch { onError(2); }
    })();

    // Stationary heartbeat: one fresh fix per stationary interval, so the
    // customer is not left with a stale point when the watcher is quiet.
    const heartbeat = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      const get = native
        ? Geolocation.getCurrentPosition({ enableHighAccuracy: false, maximumAge: 10_000, timeout: 15_000 }).then(toFix)
        : new Promise<Fix>((res, rej) => navigator.geolocation.getCurrentPosition((p) => res(toFix(p)), rej,
            { enableHighAccuracy: false, maximumAge: 10_000, timeout: 15_000 }));
      get.then(onFix).catch(() => {});
    }, cfg.stationaryIntervalS * 1000);

    const onOnline = () => {
      const f = bufferRef.current.take(Date.now());
      if (f && (!lastSentRef.current || f.capturedAt > lastSentRef.current.capturedAt)) void send(f);
    };
    window.addEventListener('online', onOnline);

    return () => {
      stopped = true;
      clearInterval(heartbeat);
      window.removeEventListener('online', onOnline);
      if (watchId !== null) {
        if (native) Geolocation.clearWatch({ id: String(watchId) }).catch(() => {});
        else navigator.geolocation.clearWatch(watchId as number);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, highAccuracy, cfg.stationaryIntervalS, cfg.movingIntervalS, cfg.minServerIntervalS]);

  return { status, activeOrderCount: orders.length };
}
