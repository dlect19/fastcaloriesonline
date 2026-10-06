import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import {
  DEFAULT_TRACKING_CONFIG as C, parseTrackingConfig, shouldPublish, isUsableFix, isMoving,
  LatestOnlyBuffer, liveState, interpolate, lastUpdatedLabel, type Fix,
} from '@/lib/riderTracking';

const SQL = readFileSync('drizzle/migrations/0041_rider_live_tracking.sql', 'utf8');
const read = (p: string) => readFileSync(p, 'utf8');
const T0 = 1_800_000_000_000;
const fix = (dLatM: number, tS: number, extra: Partial<Fix> = {}): Fix =>
  ({ lat: 7.75 + dLatM / 111_320, lng: 4.6, accuracy: 10, capturedAt: T0 + tS * 1000, ...extra });

describe('config, feature flag and kill switch', () => {
  it('safe defaults and bounded values', () => {
    expect(parseTrackingConfig({})).toEqual(C);
    expect(C).toMatchObject({ enabled: true, movingIntervalS: 12, stationaryIntervalS: 45, retentionHours: 24 });
    const c = parseTrackingConfig({ rider_tracking_moving_interval_s: '2', rider_tracking_stationary_interval_s: '999', rider_tracking_retention_hours: '500' });
    expect(c.movingIntervalS).toBe(10);
    expect(c.stationaryIntervalS).toBe(60);
    expect(c.retentionHours).toBe(72);
    expect(parseTrackingConfig({ rider_tracking_enabled: 'false' }).enabled).toBe(false);
  });
  it('server rejects every publish when disabled', () => {
    expect(SQL).toMatch(/rider_tracking_enabled', 'true'\) = 'false'[\s\S]*'disabled', 'stop', true/);
  });
});

describe('adaptive throttling and jitter', () => {
  it('first fix is sent immediately', () => { expect(shouldPublish(null, fix(0, 0), T0, C)).toBe(true); });
  it('never faster than the server minimum, even forced', () => {
    expect(shouldPublish(fix(0, 0), fix(500, 3), T0 + 3000, C, { force: true })).toBe(false);
  });
  it('meaningful movement sends right away; status change forces', () => {
    expect(shouldPublish(fix(0, 0), fix(80, 6), T0 + 6000, C, { moving: true })).toBe(true);
    expect(shouldPublish(fix(0, 0), fix(0, 6), T0 + 6000, C, { force: true })).toBe(true);
  });
  it('moving cadence ~12 s, stationary ~45 s', () => {
    expect(shouldPublish(fix(0, 0), fix(30, 11), T0 + 11000, C, { moving: true })).toBe(false);
    expect(shouldPublish(fix(0, 0), fix(30, 12), T0 + 12000, C, { moving: true })).toBe(true);
    expect(shouldPublish(fix(0, 0), fix(5, 30), T0 + 30000, C)).toBe(false); // jitter
    expect(shouldPublish(fix(0, 0), fix(5, 45), T0 + 45000, C)).toBe(true); // heartbeat
  });
  it('duplicates and out-of-order fixes are dropped', () => {
    expect(shouldPublish(fix(0, 10), fix(100, 10), T0 + 20000, C)).toBe(false);
    expect(shouldPublish(fix(0, 10), fix(100, 5), T0 + 20000, C)).toBe(false);
  });
  it('poor, invalid or stale readings are ignored', () => {
    expect(isUsableFix(fix(0, 0, { accuracy: 500 }), T0)).toBe(false);
    expect(isUsableFix({ lat: 95, lng: 0, capturedAt: T0 }, T0)).toBe(false);
    expect(isUsableFix(fix(0, 0), T0 + 120_000)).toBe(false);
    expect(isUsableFix(fix(0, 0), T0 + 1000)).toBe(true);
  });
  it('detects movement from speed or displacement, not jitter', () => {
    expect(isMoving(null, fix(0, 0, { speed: 5 }))).toBe(true);
    expect(isMoving(fix(0, 0), fix(5, 10))).toBe(false);
    expect(isMoving(fix(0, 0), fix(100, 10))).toBe(true);
  });
});

describe('offline coalescing', () => {
  it('keeps only the newest fix and drops stale ones', () => {
    const b = new LatestOnlyBuffer();
    b.set(fix(0, 0)); b.set(fix(10, 20)); b.set(fix(5, 10));
    expect(b.size).toBe(1);
    expect(b.take(T0 + 30_000)?.capturedAt).toBe(T0 + 20_000);
    expect(b.size).toBe(0);
    b.set(fix(0, 0));
    expect(b.take(T0 + 200_000)).toBeNull();
  });
});

describe('customer UI state and marker motion', () => {
  it('connecting → unavailable without data; live → stale by age', () => {
    expect(liveState(null, T0, C, 10_000)).toBe('connecting');
    expect(liveState(null, T0, C, 70_000)).toBe('unavailable');
    expect(liveState(new Date(T0 - 30_000).toISOString(), T0, C, 0)).toBe('live');
    expect(liveState(new Date(T0 - 120_000).toISOString(), T0, C, 0)).toBe('stale');
    expect(lastUpdatedLabel(new Date(T0 - 125_000).toISOString(), T0)).toBe('2 min ago');
  });
  it('interpolates smoothly and clamps', () => {
    const a = { lat: 0, lng: 0 }, b = { lat: 1, lng: 2 };
    expect(interpolate(a, b, 0)).toEqual(a);
    expect(interpolate(a, b, 1)).toEqual(b);
    expect(interpolate(a, b, 2)).toEqual(b);
    expect(interpolate(a, b, 0.5)).toEqual({ lat: 0.5, lng: 1 });
  });
  it('map loads once and makes no per-point Google route calls', () => {
    const m = read('src/components/order/LiveRiderMap.tsx').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(m).not.toMatch(/Directions|DistanceMatrix|computeRoutes|routes\.googleapis|calculate-distance|quote-delivery-fee/);
    expect(m.match(/new google\.maps\.Map\(/g)).toHaveLength(1);
    expect(m).toMatch(/if \(cancelled \|\| !mapEl\.current \|\| mapRef\.current\) return/);
    expect(read('src/lib/googleMapsLoader.ts')).toMatch(/if \(pending\) return pending/);
  });
});

describe('server authorisation, isolation and validation', () => {
  it('rider/order relationship is derived server-side from auth.uid()', () => {
    expect(SQL).toMatch(/v_uid uuid := auth\.uid\(\)/);
    expect(SQL).toMatch(/v_o\.rider_id IS DISTINCT FROM v_uid/);
    expect(SQL).not.toMatch(/\bp_rider/);
    expect(SQL).toMatch(/status NOT IN \('assigned','picked_up','on_the_way'\)/);
  });
  it('validates coordinates, accuracy, speed, timestamps and impossible jumps; rate limits', () => {
    for (const re of [/p_lat NOT BETWEEN -90 AND 90/, /p_accuracy > 1000/, /p_speed > 70/,
      /interval '30 seconds'/, /interval '2 minutes'/, /'out_of_order'/, /v_dist \/ v_dt > 70/, /'rate_limited'/, /'daily_cap'/]) {
      expect(SQL).toMatch(re);
    }
  });
  it('only the customer of the active order, the rider and admins can read; no vendor policy; no client writes', () => {
    expect(SQL).toMatch(/o\.user_id = auth\.uid\(\)[\s\S]*o\.rider_id = rider_live_locations\.rider_user_id/);
    expect(SQL).not.toMatch(/owns_vendor/);
    expect(SQL).toMatch(/GRANT SELECT ON public\.rider_live_locations TO authenticated;/);
    expect(SQL).not.toMatch(/GRANT (INSERT|UPDATE|DELETE|ALL)[^;]*rider_live_locations TO (authenticated|anon)/);
    expect(SQL).not.toMatch(/rider_live_locations TO anon/);
  });
  it('one latest row per order; stops on delivered/cancelled/reassigned; retention ≤ 72 h', () => {
    expect(SQL).toMatch(/order_id uuid PRIMARY KEY/);
    expect(SQL).toMatch(/NEW\.rider_id IS DISTINCT FROM OLD\.rider_id/);
    expect(SQL).toMatch(/LEAST\(72, GREATEST\(1/);
    expect(SQL).toMatch(/interval '90 days'/);
  });
  it('rows and metrics are separated by environment', () => {
    expect(SQL).toMatch(/environment text NOT NULL/);
    expect(SQL).toMatch(/PRIMARY KEY \(day, environment\)/);
    expect(SQL).toMatch(/WHERE environment = v_env/);
  });
  it('metrics never store coordinates', () => {
    const metrics = SQL.slice(SQL.indexOf('CREATE TABLE public.rider_tracking_daily_metrics'), SQL.indexOf('GRANT SELECT ON public.rider_tracking_daily_metrics'));
    expect(metrics).not.toMatch(/lat|lng/);
  });
  it('tracking never touches fees or orders', () => {
    const fn = SQL.slice(SQL.indexOf('FUNCTION public.publish_rider_location'), SQL.indexOf('REVOKE ALL ON FUNCTION public.publish_rider_location'));
    expect(fn).not.toMatch(/UPDATE public\.orders|delivery_fee|wallet/);
    const hook = read('src/hooks/useRiderLiveTracking.ts');
    expect(hook).not.toMatch(/\.update\(|delivery_fee/);
  });
});

describe('rider client lifecycle and cleanup', () => {
  const hook = read('src/hooks/useRiderLiveTracking.ts');
  it('tracks only active deliveries for the signed-in rider and honours the kill switch', () => {
    expect(hook).toMatch(/\.eq\('rider_id', riderUserId\)/);
    expect(hook).toMatch(/ACTIVE_TRACKING_STATUSES/);
    expect(hook).toMatch(/const active = cfg\.enabled && !!riderUserId && orders\.length > 0/);
    expect(hook).toMatch(/if \(r\?\.stop\)/);
  });
  it('clears watcher, heartbeat and listeners', () => {
    expect(hook).toMatch(/clearInterval\(heartbeat\)/);
    expect(hook).toMatch(/Geolocation\.clearWatch/);
    expect(hook).toMatch(/navigator\.geolocation\.clearWatch/);
    expect(hook).toMatch(/removeEventListener\('online'/);
    expect(hook).toMatch(/clearInterval\(t\)/);
  });
  it('does not log coordinates', () => {
    expect(hook).not.toMatch(/console\.(log|info)/);
    expect(read('src/components/order/LiveRiderMap.tsx')).not.toMatch(/console\.(log|info)/);
  });
});
