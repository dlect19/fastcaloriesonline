import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor, render, screen } from '@testing-library/react';
import { readFileSync } from 'fs';

const rpc = vi.fn();
const cap = vi.hoisted(() => ({ native: true, platform: 'android', plugins: new Set<string>(['Geolocation']) }));
const nativeGeo = vi.hoisted(() => ({
  checkPermissions: vi.fn(), requestPermissions: vi.fn(), getCurrentPosition: vi.fn(),
  watchPosition: vi.fn(), clearWatch: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => {
  const q: any = { select: () => q, eq: () => q, in: () => q, limit: () => Promise.resolve({ data: [{ id: 'o1', status: 'on_the_way' }] }) };
  const settings: any = { select: () => settings, in: () => Promise.resolve({ data: [] }) };
  return { supabase: {
    from: (t: string) => (t === 'orders' ? q : settings),
    rpc: (...a: any[]) => rpc(...a),
    channel: () => { const c: any = { on: () => c, subscribe: () => c }; return c; },
    removeChannel: vi.fn(),
  } };
});
vi.mock('@capacitor/core', () => ({ Capacitor: {
  isNativePlatform: () => cap.native,
  getPlatform: () => (cap.native ? cap.platform : 'web'),
  isPluginAvailable: (n: string) => cap.native && cap.plugins.has(n),
} }));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: nativeGeo }));

import { detectRuntime, canUseNativeGeolocation, isUnimplementedError } from '@/lib/nativeRuntime';
import { classifyNativeError } from '@/lib/riderGeoDiagnostics';
import { useRiderLiveTracking, ACQUISITION_TIMING } from '@/hooks/useRiderLiveTracking';
import { RiderTrackingStatus } from '@/components/rider/RiderTrackingStatus';

const pos = () => ({ coords: { latitude: 6.5, longitude: 3.4, accuracy: 25, speed: null, heading: null }, timestamp: Date.now() });
let webGet: any; let webWatch: any;

beforeEach(() => {
  cap.native = true; cap.platform = 'android'; cap.plugins = new Set(['Geolocation']);
  rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  Object.values(nativeGeo).forEach((f: any) => f.mockReset());
  nativeGeo.checkPermissions.mockResolvedValue({ location: 'granted', coarseLocation: 'granted' });
  nativeGeo.getCurrentPosition.mockResolvedValue(pos());
  nativeGeo.watchPosition.mockResolvedValue('w1');
  nativeGeo.clearWatch.mockResolvedValue(undefined);
  webGet = vi.fn(); webWatch = vi.fn(() => 9);
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: webGet, watchPosition: webWatch, clearWatch: vi.fn() } });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
});

describe('runtime detection is bridge-based, not URL/UA based', () => {
  it('Capacitor WebView served from https://app.fastcalories.online is native', () => {
    const win = { location: { protocol: 'https:', hostname: 'app.fastcalories.online' }, androidBridge: {}, navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) Chrome/120' } };
    const r = detectRuntime(win, { isNativePlatform: () => false, getPlatform: () => 'web' });
    expect(r).toMatchObject({ platform: 'android', bridge: true, shellWithoutBridge: false });
    const viaCap = detectRuntime({ navigator: { userAgent: '' } }, { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => true });
    expect(canUseNativeGeolocation(viaCap)).toBe(true);
  });
  it('iOS bridge detected', () => {
    const r = detectRuntime({ webkit: { messageHandlers: { bridge: {} } }, navigator: { userAgent: '' } }, {});
    expect(r.platform).toBe('ios');
  });
  it('plain https browser is web; user agent alone never makes it native', () => {
    const r = detectRuntime({ navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14; wv) FastCalories' } }, { isNativePlatform: () => false });
    expect(r.bridge).toBe(false); expect(r.platform).toBe('web');
    expect(canUseNativeGeolocation(r)).toBe(false);
    expect(r.shellWithoutBridge).toBe(true); // display hint only
  });
  it('plugin unavailable → no native geolocation routing', () => {
    const r = detectRuntime({ navigator: { userAgent: '' } }, { isNativePlatform: () => true, getPlatform: () => 'android', isPluginAvailable: () => false });
    expect(r.geolocationPlugin).toBe(false); expect(canUseNativeGeolocation(r)).toBe(false);
  });
  it('maps native plugin error codes truthfully', () => {
    expect(classifyNativeError('x', 'OS-PLUG-GLOC-0003')).toBe('app_permission_denied');
    expect(classifyNativeError('x', 'OS-PLUG-GLOC-0007')).toBe('device_location_off');
    expect(classifyNativeError('x', 'OS-PLUG-GLOC-0017')).toBe('device_location_off');
    expect(classifyNativeError('x', 'OS-PLUG-GLOC-0010')).toBe('timeout');
    expect(classifyNativeError('x', 'OS-PLUG-GLOC-0002')).toBe('position_unavailable');
    expect(isUnimplementedError({ code: 'UNIMPLEMENTED' })).toBe(true);
  });
});

describe('native Android tracking uses @capacitor/geolocation only', () => {
  it('granted → immediate publish, one native watcher, no browser geolocation call', async () => {
    const { result } = renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(nativeGeo.watchPosition).toHaveBeenCalledTimes(1));
    expect(webGet).not.toHaveBeenCalled(); expect(webWatch).not.toHaveBeenCalled();
    expect(result.current.diagnostics).toMatchObject({ platform: 'android', bridge: true, geoPlugin: true, perm: 'fine:granted/coarse:granted' });
  });
  it('one-shot failure → native warm-up watch success publishes', async () => {
    nativeGeo.getCurrentPosition.mockRejectedValue({ code: 'OS-PLUG-GLOC-0002', message: 'error' });
    let cb: any;
    nativeGeo.watchPosition.mockImplementation(async (_o: any, c: any) => { cb = c; return 'warm'; });
    renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(cb).toBeTruthy());
    await act(async () => { cb(pos(), undefined); });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await waitFor(() => expect(nativeGeo.clearWatch).toHaveBeenCalledWith({ id: 'warm' }));
    expect(webGet).not.toHaveBeenCalled();
  });
  it('permission denied → app permission problem, Retry requests natively and recovers', async () => {
    nativeGeo.checkPermissions.mockResolvedValueOnce({ location: 'denied', coarseLocation: 'denied' });
    nativeGeo.requestPermissions.mockResolvedValue({ location: 'granted', coarseLocation: 'granted' });
    const { result } = renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(result.current.problem).toBe('app_permission_denied'));
    expect(rpc).not.toHaveBeenCalled();
    nativeGeo.checkPermissions.mockResolvedValue({ location: 'denied', coarseLocation: 'denied' });
    act(() => { result.current.retry(); });
    await waitFor(() => expect(nativeGeo.requestPermissions).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(webGet).not.toHaveBeenCalled();
  });
  it('unmount clears the native watcher', async () => {
    const { unmount } = renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(nativeGeo.watchPosition).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    unmount();
    expect(nativeGeo.clearWatch).toHaveBeenCalledWith({ id: 'w1' });
  });
  it('native shell without the Geolocation plugin → App update required, no browser fallback', async () => {
    cap.plugins = new Set();
    const { result } = renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(result.current.status).toBe('update_required'));
    expect(webGet).not.toHaveBeenCalled(); expect(nativeGeo.getCurrentPosition).not.toHaveBeenCalled();
    render(<RiderTrackingStatus status="update_required" activeOrderCount={1} onRetry={() => {}} diagnostics={result.current.diagnostics} />);
    expect(screen.getByText(/App update required/)).toBeTruthy();
    expect(screen.getByText(/NATIVE_GEO_PLUGIN_MISSING/)).toBeTruthy();
    expect(screen.getByTestId('tracking-diagnostics').textContent).toMatch(/platform=android · bridge=yes · geolocation_plugin=no/);
  });
  it('app WebView without bridge shows App update required instead of Chrome instructions', async () => {
    cap.native = false;
    Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit Chrome/120 Mobile' });
    webGet.mockImplementation((_ok: any, err: any) => err({ code: 2 }));
    const T = { ...ACQUISITION_TIMING };
    Object.assign(ACQUISITION_TIMING, { cachedTimeoutMs: 10, balancedWatchMs: 30, highWatchMs: 30 });
    const { result } = renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(result.current.problem).toBe('app_update_required'), { timeout: 4000 });
    expect(result.current.diagnostics.lastCode).toBe('position_unavailable');
    expect(result.current.diagnostics.bridge).toBe(false);
    Object.assign(ACQUISITION_TIMING, T);
  });
  it('diagnostics never include coordinates', () => {
    const src = readFileSync('src/lib/nativeRuntime.ts', 'utf8');
    expect(src).not.toMatch(/latitude|longitude|console\./);
  });
});
