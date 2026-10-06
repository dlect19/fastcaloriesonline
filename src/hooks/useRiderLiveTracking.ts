/**
 * Publishes the rider's location only while they are assigned to an active
 * delivery (assigned → picked_up → on_the_way). Foreground only: the watcher
 * runs while the rider app is open; it is stopped on delivery, cancellation,
 * reassignment, kill switch, logout/unmount or when no active delivery exists.
 *
 * Start-up: active orders are loaded immediately and on every realtime change
 * to this rider's orders (bounded fallback poll), permission is confirmed, and
 * one fresh fix is published at once instead of waiting for the cadence.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { supabase } from '@/integrations/supabase/client';
import { useTrackingConfig } from '@/hooks/useTrackingConfig';
import {
  classifyNativeError, classifyWebError, webPreflight, FIRST_FIX_LADDER, NEEDS_RIDER_ACTION, type GeoProblem, type WebPermState,
} from '@/lib/riderGeoDiagnostics';
import {
  ACTIVE_TRACKING_STATUSES, isMoving, isUsableFix, LatestOnlyBuffer, shouldPublish, type Fix,
} from '@/lib/riderTracking';

export type RiderTrackingStatus =
  | 'idle' | 'paused_offline' | 'starting' | 'tracking' | 'problem' | 'update_required' | 'disabled';

export const ORDER_POLL_MS = 30_000;

/** RPC missing on the server/schema cache → this app bundle is out of step. */
export function isMissingRpcError(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === 'PGRST202' || err.code === '42883' || /could not find the function/i.test(err.message || '');
}

async function webPermState(): Promise<WebPermState> {
  try {
    const q = await (navigator as any).permissions?.query?.({ name: 'geolocation' });
    return (q?.state as WebPermState) || 'unknown';
  } catch { return 'unknown'; }
}

/** Native: Capacitor permission APIs only (never browser permission logic). */
async function nativePermission(): Promise<GeoProblem | null> {
  try {
    let p = await Geolocation.checkPermissions();
    const ok = () => p.location === 'granted' || p.coarseLocation === 'granted';
    if (!ok()) p = await Geolocation.requestPermissions({ permissions: ['location', 'coarseLocation'] } as any);
    return ok() ? null : 'app_permission_denied';
  } catch (e: any) {
    return classifyNativeError(e?.message);
  }
}

const FIX_TIMEOUT_MS = 15_000;

/**
 * Web acquisition budget (total ≤ ~55 s): cached one-shot → balanced warm-up
 * watch → high-accuracy warm-up watch. Mutable only so tests can shorten it.
 */
export const ACQUISITION_TIMING = { cachedTimeoutMs: 5_000, balancedWatchMs: 30_000, highWatchMs: 20_000, resumeCooldownMs: 20_000, retryDebounceMs: 3_000 };
export type AcquisitionStage = 'cached' | 'balanced_watch' | 'high_accuracy' | 'failed' | null;

export interface TrackingDiagnostics {
  online: boolean; assigned: number; platform: 'native' | 'browser'; secure: boolean; lastCode: string | null; stage: AcquisitionStage;
}

/** Runs one fix ladder step-by-step; stops on the first fix or a permission denial. */
export function runFixLadder(
  get: (o: PositionOptions) => Promise<Fix>,
  isDenied: (e: any) => boolean,
  ladder: PositionOptions[] = FIRST_FIX_LADDER,
): Promise<Fix> {
  return ladder.reduce<Promise<Fix>>(
    (prev, opt) => prev.catch((e) => (e && e !== LADDER_START && isDenied(e) ? Promise.reject(e) : get(opt))),
    Promise.reject(LADDER_START),
  );
}
const LADDER_START = { ladderStart: true };

export function useRiderLiveTracking(riderUserId: string | null | undefined, opts: { online?: boolean } = {}) {
  const online = opts.online ?? true;
  const onlineRef = useRef(online);
  onlineRef.current = online;
  const [lastCode, setLastCode] = useState<string | null>(null);
  const [stage, setStage] = useState<AcquisitionStage>(null);
  const lastResumeRef = useRef(0);
  const lastRetryRef = useRef(0);
  const cfg = useTrackingConfig();
  const [status, setStatus] = useState<RiderTrackingStatus>('idle');
  const [orders, setOrders] = useState<{ id: string; status: string }[]>([]);
  const [highAccuracy, setHighAccuracy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [problem, setProblem] = useState<GeoProblem | null>(null);
  const onFixRef = useRef<(f: Fix) => void>(() => {});
  const problemRef = useRef<GeoProblem | null>(null);
  problemRef.current = problem;
  const ordersCountRef = useRef(0);
  const trackingRef = useRef(false);
  trackingRef.current = status === 'tracking';
  const lastSentRef = useRef<Fix | null>(null);
  const lastFixRef = useRef<Fix | null>(null);
  const forceRef = useRef(false);
  const stillSinceRef = useRef<number | null>(null);
  const bufferRef = useRef(new LatestOnlyBuffer());
  const ordersRef = useRef(orders);
  ordersRef.current = orders;
  ordersCountRef.current = orders.length;
  const loadRef = useRef<() => void>(() => {});

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
    loadRef.current = () => { void load(); };
    load();
    // React to assignment/status changes for this rider's orders right away.
    const ch = supabase.channel(`rider-track-orders-${riderUserId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `rider_id=eq.${riderUserId}` },
        () => { void load(); })
      .subscribe();
    const t = setInterval(load, ORDER_POLL_MS); // bounded fallback
    const onVis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      cancelled = true; clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      supabase.removeChannel(ch);
    };
  }, [riderUserId, cfg.enabled]);

  // Tracking runs only while the rider is Online AND has an eligible delivery.
  const active = cfg.enabled && !!riderUserId && online && orders.length > 0;

  useEffect(() => {
    if (!cfg.enabled) setStatus('disabled');
    else if (!active) { setStatus(!online && orders.length > 0 ? 'paused_offline' : 'idle'); setProblem(null); }
  }, [active, cfg.enabled, online, orders.length]);

  useEffect(() => {
    if (!active) return;
    let stopped = false;
    let watchId: string | number | null = null;
    const native = Capacitor.isNativePlatform();
    setStatus((s) => (s === 'tracking' ? s : 'starting'));

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
        if (error) {
          if (isMissingRpcError(error)) { setStatus('update_required'); return; }
          bufferRef.current.set(fix); lastSentRef.current = null; continue;
        }
        const r = data as { ok: boolean; stop?: boolean } | null;
        if (r?.stop) setOrders((cur) => cur.filter((x) => x.id !== o.id));
        else if (r?.ok) { setProblem(null); setStatus('tracking'); }
      }
    };

    const onFix = (fix: Fix) => {
      if (stopped) return;
      const now = Date.now();
      if (!isUsableFix(fix, now)) return;
      const moving = isMoving(lastFixRef.current, fix);
      lastFixRef.current = fix;
      // Back off to low-power GPS after 2 minutes stationary; restore when moving.
      if (moving) { stillSinceRef.current = null; if (!highAccuracy) setHighAccuracy(true); }
      else {
        stillSinceRef.current ??= now;
        if (highAccuracy && now - stillSinceRef.current > 120_000) setHighAccuracy(false);
      }
      if (shouldPublish(lastSentRef.current, fix, now, cfg, { force: forceRef.current, moving })) void send(fix);
    };

    const fail = (p: GeoProblem) => {
      if (stopped) return;
      // A transient timeout while already tracking is not shown as a failure.
      if (trackingRef.current && p === 'timeout') return;
      setLastCode(p);
      setStatus('problem'); setProblem(p);
    };
    const onWebError = async (code?: number) => fail(classifyWebError(code, await webPermState()));
    onFixRef.current = onFix;

    const toFix = (p: any): Fix => ({
      lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy,
      speed: p.coords.speed, heading: p.coords.heading,
      // Some WebViews report a cached timestamp; never trust one in the future.
      capturedAt: Math.min(Date.now(), p.timestamp || Date.now()),
    });
    const opts = { enableHighAccuracy: highAccuracy, maximumAge: 5000, timeout: 20000 };
    const getOnce = (o: PositionOptions): Promise<Fix> => native
      ? Geolocation.getCurrentPosition(o).then(toFix)
      : new Promise<Fix>((res, rej) => navigator.geolocation.getCurrentPosition((p) => res(toFix(p)), rej, o));

    // First fix: cached → balanced (network/Wi-Fi) → high-accuracy GPS.
    // High accuracy is never required for the first fix. Bounded, no loops.
    const isDenied = (e: any) => native ? classifyNativeError(e?.message) === 'app_permission_denied' : e?.code === 1;
    const firstFix = async (): Promise<boolean> => {
      forceRef.current = true;
      try { onFix(await runFixLadder(getOnce, isDenied)); return true; }
      catch (e: any) {
        if (native) fail(classifyNativeError(e?.message)); else await onWebError(e?.code);
        return false;
      }
    };
    // Watch errors after a recent good fix are transient; don't flash a banner.
    const recentFix = () => !!lastFixRef.current && Date.now() - lastFixRef.current.capturedAt < 120_000;

    // Bounded web acquisition: exactly one warm-up watcher at a time, all timers
    // cleared on success, failure or cleanup.
    let warmId: number | null = null;
    let warmTimer: ReturnType<typeof setTimeout> | null = null;
    const clearWarm = () => {
      if (warmId !== null) navigator.geolocation.clearWatch(warmId);
      if (warmTimer) clearTimeout(warmTimer);
      warmId = null; warmTimer = null;
    };
    const acquireWeb = () => new Promise<boolean>((resolve) => {
      forceRef.current = true;
      let lastErr = 2;
      let settled = false;
      const done = (ok: boolean, problem?: GeoProblem) => {
        if (settled) return; settled = true;
        clearWarm();
        if (!ok && problem && !stopped) { setStage('failed'); fail(problem); }
        resolve(ok && !stopped);
      };
      const warm = (hi: boolean, ms: number, next: () => void) => {
        if (stopped) return done(false);
        clearWarm();
        setStage(hi ? 'high_accuracy' : 'balanced_watch');
        warmId = navigator.geolocation.watchPosition(
          (p) => {
            const f = toFix(p);
            if (!isUsableFix(f, Date.now())) return;
            clearWarm(); onFix(f); done(true);
          },
          (e) => { if (e.code === 1) { void webPermState().then((st) => done(false, classifyWebError(1, st))); } else lastErr = e.code; },
          { enableHighAccuracy: hi, maximumAge: hi ? 0 : 30_000, timeout: ms },
        );
        warmTimer = setTimeout(() => { clearWarm(); next(); }, ms);
      };
      const high = () => warm(true, ACQUISITION_TIMING.highWatchMs, () => done(false, lastErr === 3 ? 'timeout' : 'position_unavailable'));
      setStage('cached');
      navigator.geolocation.getCurrentPosition(
        (p) => { const f = toFix(p); if (isUsableFix(f, Date.now())) { onFix(f); done(true); } else warm(false, ACQUISITION_TIMING.balancedWatchMs, high); },
        (e) => {
          if (e.code === 1) { void webPermState().then((st) => done(false, classifyWebError(1, st))); return; }
          lastErr = e.code;
          warm(false, ACQUISITION_TIMING.balancedWatchMs, high);
        },
        { enableHighAccuracy: false, maximumAge: 120_000, timeout: ACQUISITION_TIMING.cachedTimeoutMs },
      );
    });

    (async () => {
      if (native) {
        const p = await nativePermission();
        if (stopped) return;
        if (p) { fail(p); return; }
      } else {
        const pre = webPreflight({ secure: window.isSecureContext !== false, hasGeo: 'geolocation' in navigator });
        if (pre) { fail(pre); return; }
        // A previously blocked site can only be fixed by the rider + a Retry tap.
        if ((await webPermState()) === 'denied') { if (!stopped) fail('site_permission_denied'); return; }
      }
      if (stopped) return;
      // Web: a one-shot POSITION_UNAVAILABLE must not end tracking — Chrome often
      // only delivers a fix to an ongoing watch. Native keeps the plugin ladder.
      const acquired = native ? await firstFix() : await acquireWeb();
      if (!acquired || stopped) return;
      try {
        if (native) {
          const id = await Geolocation.watchPosition(opts, (pos, err) => {
            if (err) { if (!recentFix()) fail(classifyNativeError(err?.message)); return; }
            if (pos) onFix(toFix(pos));
          });
          if (stopped) Geolocation.clearWatch({ id }); else watchId = id;
        } else {
          watchId = navigator.geolocation.watchPosition((p) => onFix(toFix(p)), (e) => { if (e.code === 1 || !recentFix()) void onWebError(e.code); }, opts);
        }
      } catch (e: any) { fail(native ? classifyNativeError(e?.message) : 'position_unavailable'); }
    })();

    // Stationary heartbeat: one fresh fix per stationary interval, so the
    // customer is not left with a stale point when the watcher is quiet.
    const heartbeat = setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      getOnce({ enableHighAccuracy: false, maximumAge: 10_000, timeout: 15_000 }).then(onFix).catch(() => {});
    }, cfg.stationaryIntervalS * 1000);

    // Auto-recover provider/timeout problems on focus, visibility or network restore.
    // Permission problems wait for the rider's Retry tap.
    const resume = () => {
      if (stopped || document.visibilityState !== 'visible') return;
      if (!problemRef.current || NEEDS_RIDER_ACTION.includes(problemRef.current)) return;
      const now = Date.now();
      if (now - lastResumeRef.current < ACQUISITION_TIMING.resumeCooldownMs) return; // no retry storms
      lastResumeRef.current = now;
      setAttempt((n) => n + 1);
    };
    const onOnline = () => {
      const f = bufferRef.current.take(Date.now());
      if (f && (!lastSentRef.current || f.capturedAt > lastSentRef.current.capturedAt)) void send(f);
      resume();
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('focus', resume);
    document.addEventListener('visibilitychange', resume);

    return () => {
      stopped = true;
      if (!native) clearWarm();
      clearInterval(heartbeat);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('focus', resume);
      document.removeEventListener('visibilitychange', resume);
      if (watchId !== null) {
        if (native) Geolocation.clearWatch({ id: String(watchId) }).catch(() => {});
        else navigator.geolocation.clearWatch(watchId as number);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, highAccuracy, attempt, cfg.stationaryIntervalS, cfg.movingIntervalS, cfg.minServerIntervalS]);

  /**
   * Rider-initiated retry. Must be called from the tap handler: on web the
   * geolocation request is made synchronously inside the user gesture, so
   * Chrome can show its prompt; on success the watcher is restarted.
   */
  const retry = useCallback(() => {
    // Only while Online with an eligible delivery.
    if (!onlineRef.current || ordersCountRef.current === 0) { loadRef.current(); return; }
    const now = Date.now();
    if (now - lastRetryRef.current < ACQUISITION_TIMING.retryDebounceMs) return; // repeated taps
    lastRetryRef.current = now;
    lastSentRef.current = null;
    forceRef.current = true;
    loadRef.current();
    setProblem(null); setLastCode(null);
    setStatus('starting');
    if (!Capacitor.isNativePlatform() && 'geolocation' in navigator) {
      // Issued synchronously inside the tap so Chrome can show its prompt and
      // re-check site permission. One-shot only — never creates a watcher.
      navigator.geolocation.getCurrentPosition(
        (p) => onFixRef.current({
          lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy,
          speed: p.coords.speed, heading: p.coords.heading, capturedAt: Math.min(Date.now(), p.timestamp || Date.now()),
        }),
        () => {},
        { enableHighAccuracy: false, maximumAge: 120_000, timeout: ACQUISITION_TIMING.cachedTimeoutMs },
      );
    }
    // Restart acquisition: effect cleanup clears any existing watcher/timers first.
    setAttempt((n) => n + 1);
  }, []);

  const diagnostics: TrackingDiagnostics = {
    online, assigned: orders.length,
    platform: Capacitor.isNativePlatform() ? 'native' : 'browser',
    secure: typeof window === 'undefined' ? true : window.isSecureContext !== false,
    lastCode, stage,
  };
  return { status, problem, activeOrderCount: orders.length, retry, diagnostics };
}
