// Pure policy for live rider tracking (rider publish throttling, jitter
// filtering, offline coalescing, customer stale/interpolation). No network.

export const ACTIVE_TRACKING_STATUSES = ['assigned', 'picked_up', 'on_the_way'] as const;

export interface TrackingConfig {
  enabled: boolean;
  movingIntervalS: number;
  stationaryIntervalS: number;
  staleAfterS: number;
  retentionHours: number;
  routeRefreshMin: number;
  minServerIntervalS: number;
}

export const DEFAULT_TRACKING_CONFIG: TrackingConfig = {
  enabled: true,
  movingIntervalS: 12,
  stationaryIntervalS: 45,
  staleAfterS: 90,
  retentionHours: 24,
  routeRefreshMin: 3,
  minServerIntervalS: 5,
};

export const TRACKING_SETTING_KEYS: Record<keyof TrackingConfig, string> = {
  enabled: 'rider_tracking_enabled',
  movingIntervalS: 'rider_tracking_moving_interval_s',
  stationaryIntervalS: 'rider_tracking_stationary_interval_s',
  staleAfterS: 'rider_tracking_stale_after_s',
  retentionHours: 'rider_tracking_retention_hours',
  routeRefreshMin: 'rider_tracking_route_refresh_min',
  minServerIntervalS: 'rider_tracking_min_server_interval_s',
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Parse platform_settings rows with safe bounds. */
export function parseTrackingConfig(map: Record<string, string | null | undefined>): TrackingConfig {
  const num = (k: keyof TrackingConfig, lo: number, hi: number) => {
    const v = Number(map[TRACKING_SETTING_KEYS[k]]);
    return Number.isFinite(v) && map[TRACKING_SETTING_KEYS[k]] !== '' && map[TRACKING_SETTING_KEYS[k]] != null
      ? clamp(v, lo, hi) : (DEFAULT_TRACKING_CONFIG[k] as number);
  };
  return {
    enabled: map[TRACKING_SETTING_KEYS.enabled] !== 'false',
    movingIntervalS: num('movingIntervalS', 10, 15),
    stationaryIntervalS: num('stationaryIntervalS', 30, 60),
    staleAfterS: num('staleAfterS', 30, 600),
    retentionHours: num('retentionHours', 1, 72),
    routeRefreshMin: num('routeRefreshMin', 2, 5),
    minServerIntervalS: num('minServerIntervalS', 1, 10),
  };
}

export interface Fix {
  lat: number;
  lng: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  capturedAt: number; // ms epoch
}

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Readings this poor are ignored rather than shown to the customer. */
// Matches the server limit; coarse phone/PWA fixes are still shown (with
// accuracy) rather than silently dropped, which left customers with no point.
export const MAX_USABLE_ACCURACY_M = 1000;
/** Movement counted as real (not GPS jitter). */
export const MEANINGFUL_MOVE_M = 50;

export function isUsableFix(f: Fix, now: number): boolean {
  if (!Number.isFinite(f.lat) || !Number.isFinite(f.lng)) return false;
  if (Math.abs(f.lat) > 90 || Math.abs(f.lng) > 180) return false;
  if (f.accuracy != null && f.accuracy > MAX_USABLE_ACCURACY_M) return false;
  if (now - f.capturedAt > 60_000) return false; // stale cached reading
  return true;
}

export function isMoving(prev: Fix | null, next: Fix): boolean {
  if (next.speed != null && next.speed > 1.5) return true;
  if (!prev) return false;
  const dt = (next.capturedAt - prev.capturedAt) / 1000;
  const jitter = Math.max(15, next.accuracy ?? 15);
  return dt > 0 && distanceM(prev, next) > jitter && distanceM(prev, next) / dt > 1;
}

/**
 * Decide whether a new fix should be published.
 * - never faster than the server minimum;
 * - immediately on meaningful movement or a forced status change;
 * - otherwise on the moving (10–15 s) or stationary (30–60 s) cadence;
 * - jitter inside the accuracy circle is only sent on the stationary heartbeat.
 */
export function shouldPublish(
  lastSent: Fix | null,
  next: Fix,
  now: number,
  cfg: TrackingConfig,
  opts: { force?: boolean; moving?: boolean } = {},
): boolean {
  if (!lastSent) return true;
  const since = (now - lastSent.capturedAt) / 1000;
  if (since < cfg.minServerIntervalS) return false;
  if (next.capturedAt <= lastSent.capturedAt) return false; // duplicate / out of order
  if (opts.force) return true;
  const d = distanceM(lastSent, next);
  const jitter = Math.max(15, next.accuracy ?? 15, lastSent.accuracy ?? 15);
  if (d >= MEANINGFUL_MOVE_M && d > jitter) return true;
  const interval = opts.moving ? cfg.movingIntervalS : cfg.stationaryIntervalS;
  if (d <= jitter) return since >= cfg.stationaryIntervalS;
  return since >= interval;
}

/** Keeps only the newest unsent fix while offline — never a trail. */
export class LatestOnlyBuffer {
  private item: Fix | null = null;
  set(f: Fix) { if (!this.item || f.capturedAt > this.item.capturedAt) this.item = f; }
  take(now: number, maxAgeMs = 110_000): Fix | null {
    const f = this.item; this.item = null;
    return f && now - f.capturedAt <= maxAgeMs ? f : null;
  }
  get size() { return this.item ? 1 : 0; }
}

export type LiveState = 'connecting' | 'waiting' | 'live' | 'stale';

/** Bounded connection window before telling the customer we're waiting on the rider. */
export const CONNECT_WINDOW_MS = 20_000;

export function liveState(receivedAt: string | null, now: number, cfg: TrackingConfig, waitedMs: number): LiveState {
  if (!receivedAt) return waitedMs > CONNECT_WINDOW_MS ? 'waiting' : 'connecting';
  const age = (now - new Date(receivedAt).getTime()) / 1000;
  return age > cfg.staleAfterS ? 'stale' : 'live';
}

/** Smooth marker motion between two points; t in [0,1] with ease-in-out. */
export function interpolate(a: { lat: number; lng: number }, b: { lat: number; lng: number }, t: number) {
  const x = Math.min(1, Math.max(0, t));
  const e = x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
  return { lat: a.lat + (b.lat - a.lat) * e, lng: a.lng + (b.lng - a.lng) * e };
}

export function lastUpdatedLabel(receivedAt: string | null, now: number): string {
  if (!receivedAt) return '';
  const s = Math.max(0, Math.round((now - new Date(receivedAt).getTime()) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return `${m} min ago`;
}
