import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { isNativeRiderTrackingAvailable, ordersKeyOf, planNativeTracking, TOKEN_REFRESH_MARGIN_MS, NATIVE_MAX_RESTARTS } from '@/lib/nativeRiderTracking';
import { checkTarget } from '../../scripts/verify-app-target.mjs';

const base = { active: true, visible: true, running: false, startedKey: null as string | null, ordersKey: 'a', expiresAt: 0, now: 1_000_000, restarts: 0 };
const svc = readFileSync('android-rider/app/src/main/java/com/customers/fastcalories/app/RiderTrackingService.java', 'utf8');
const plugin = readFileSync('android-rider/app/src/main/java/com/customers/fastcalories/app/RiderTrackingPlugin.java', 'utf8');
const hook = readFileSync('src/hooks/useRiderLiveTracking.ts', 'utf8');
const sql = readFileSync('drizzle/migrations/0043_migration.sql', 'utf8');

describe('native background tracking lifecycle decisions', () => {
  it('is only available on Android with the RiderTracking plugin registered', () => {
    expect(isNativeRiderTrackingAvailable({ getPlatform: () => 'android', isPluginAvailable: (n) => n === 'RiderTracking' })).toBe(true);
    expect(isNativeRiderTrackingAvailable({ getPlatform: () => 'android', isPluginAvailable: () => false })).toBe(false); // customer app
    expect(isNativeRiderTrackingAvailable({ getPlatform: () => 'ios', isPluginAvailable: () => true })).toBe(false);
    expect(isNativeRiderTrackingAvailable({ getPlatform: () => 'web', isPluginAvailable: () => true })).toBe(false);
  });
  it('starts only while visible with an authorised active delivery', () => {
    expect(planNativeTracking(base)).toBe('start');
    expect(planNativeTracking({ ...base, visible: false })).toBe('noop'); // Android forbids background FGS start
  });
  it('stops on completion, cancellation, reassignment, offline or logout (inactive)', () => {
    expect(planNativeTracking({ ...base, active: false, running: true })).toBe('stop');
    expect(planNativeTracking({ ...base, active: false, startedKey: 'a' })).toBe('stop');
    expect(planNativeTracking({ ...base, active: false })).toBe('noop');
    expect(planNativeTracking({ ...base, active: false, visible: false, running: true })).toBe('stop');
  });
  it('restarts for a changed delivery set or near token expiry, never duplicates a running tracker', () => {
    const ok = { ...base, running: true, startedKey: 'a', expiresAt: base.now + 2 * 3600_000 };
    expect(planNativeTracking(ok)).toBe('noop');
    expect(planNativeTracking({ ...ok, ordersKey: 'a,b' })).toBe('start');
    expect(planNativeTracking({ ...ok, expiresAt: base.now + TOKEN_REFRESH_MARGIN_MS - 1 })).toBe('start');
    expect(planNativeTracking({ ...ok, running: false, restarts: NATIVE_MAX_RESTARTS })).toBe('noop'); // bounded
    expect(ordersKeyOf([{ id: 'b' }, { id: 'a' }])).toBe('a,b');
  });
  it('JS watcher never runs alongside the native service', () => {
    expect(hook).toContain('if (!active || nativeBg) return;');
    expect(hook).toContain("onAuthStateChange((ev) => {");
    expect(hook).toContain("RiderTracking.stop()");
    expect(hook).toContain("revoke_my_rider_tracking_tokens");
    expect(hook).not.toMatch(/refresh_token|access_token/); // session tokens never reach native
  });
});

describe('native service upload boundaries', () => {
  it('uploads natively with a per-delivery token (not JS callbacks, not the session)', () => {
    expect(svc).toContain('/rest/v1/rpc/publish_rider_location_native');
    expect(svc).toContain('HttpURLConnection');
    expect(svc).not.toMatch(/notifyListeners|refresh_token/);
    expect(svc).toContain('FOREGROUND_SERVICE_TYPE_LOCATION');
  });
  it('coalesces to latest-only, ~1 s while moving, bounded offline retry and age', () => {
    expect(svc).toContain('MOVING_INTERVAL_MS = 1000');
    expect(svc).toContain('STILL_HEARTBEAT_MS = 10_000');
    expect(svc).toContain('MAX_FIX_AGE_MS = 110_000');
    expect(svc).toMatch(/pending = l; \/\/ latest-only/);
    expect(svc).toMatch(/Math\.min\(30_000L/);
    expect(svc).toContain('if (since <= 0) return false; // duplicate / out of order');
    expect(svc).toMatch(/if \(callback != null\) return; \/\/ exactly one location request/);
  });
  it('stops and clears stored tokens on server stop, expiry, or explicit stop', () => {
    expect(svc).toContain('if (orders.isEmpty()) { stopAndClear("no_active_delivery"); return; }');
    expect(svc).toContain('stopAndClear("token_expired")');
    expect(svc).toMatch(/stopAndClear[\s\S]*edit\(\)\.clear\(\)/);
    expect(plugin).toContain('permission_denied');
    expect(plugin).toMatch(/stop\(PluginCall[\s\S]*edit\(\)\.clear\(\)/);
  });
});

describe('server ingestion for native uploads', () => {
  it('stores only token hashes and checks ownership, active status and environment each upload', () => {
    expect(sql).toContain("token_hash text NOT NULL UNIQUE");
    expect(sql).toContain("encode(extensions.digest(p_token, 'sha256'), 'hex')");
    expect(sql).toMatch(/v_o\.rider_id IS DISTINCT FROM v_uid[\s\S]*'not_assigned', 'stop', true/);
    expect(sql).toMatch(/NOT IN \('assigned','picked_up','on_the_way'\)[\s\S]*DELETE FROM public\.rider_live_locations/);
    expect(sql).toContain("v_t.environment <> v_env");
    expect(sql).toContain("'out_of_order'");
    expect(sql).toContain("rider_tracking_native_min_interval_s','1'");
  });
  it('keeps the JS publish path unchanged and token issuance authenticated-only', () => {
    expect(sql).not.toMatch(/CREATE OR REPLACE FUNCTION public\.publish_rider_location\(/);
    expect(sql).toMatch(/issue_rider_tracking_token\(uuid\) FROM PUBLIC, anon/);
  });
});

describe('rider Android target branding and isolation', () => {
  it('rider target passes identity, green branding and service checks; customer has no rider service', () => {
    expect(checkTarget('rider', 'native')).toEqual([]);
    expect(checkTarget('customer', 'native')).toEqual([]);
    const colors = readFileSync('android-rider/app/src/main/res/values/colors.xml', 'utf8');
    expect(colors).toContain('#1E9301');
    expect(readFileSync('android/app/src/main/res/values/colors.xml', 'utf8')).toContain('#FF6B35');
    expect(readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8')).not.toContain('RiderTrackingService');
  });
});
