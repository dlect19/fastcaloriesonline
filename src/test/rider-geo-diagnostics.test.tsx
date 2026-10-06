import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor, render, screen, fireEvent } from '@testing-library/react';
import { readFileSync } from 'fs';
import { classifyWebError, classifyNativeError, webPreflight, GEO_DIAGNOSTIC_CODE } from '@/lib/riderGeoDiagnostics';

const rpc = vi.fn();
let orderRows: { id: string; status: string }[] = [];
let native = false;
const nativeGeo = vi.hoisted(() => ({
  checkPermissions: vi.fn(), requestPermissions: vi.fn(), getCurrentPosition: vi.fn(),
  watchPosition: vi.fn(async () => 'w1'), clearWatch: vi.fn(async () => {}),
}));

vi.mock('@/integrations/supabase/client', () => {
  const q: any = { select: () => q, eq: () => q, in: () => q, limit: () => Promise.resolve({ data: orderRows }) };
  const settings: any = { select: () => settings, in: () => Promise.resolve({ data: [] }) };
  return { supabase: {
    from: (t: string) => (t === 'orders' ? q : settings),
    rpc: (...a: any[]) => rpc(...a),
    channel: () => { const c: any = { on: () => c, subscribe: () => c }; return c; },
    removeChannel: vi.fn(),
  } };
});
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => native } }));
vi.mock('@capacitor/geolocation', () => ({ Geolocation: nativeGeo }));

import { useRiderLiveTracking } from '@/hooks/useRiderLiveTracking';
import { RiderTrackingStatus } from '@/components/rider/RiderTrackingStatus';

const pos = () => ({ coords: { latitude: 6.5, longitude: 3.4, accuracy: 30, speed: null, heading: null }, timestamp: Date.now() });
let permState = 'prompt';
let getCurrent: any; let watch: any;

function setupWeb() {
  getCurrent = vi.fn((ok: any) => ok(pos()));
  watch = vi.fn(() => 3);
  Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: getCurrent, watchPosition: watch, clearWatch: vi.fn() } });
  Object.defineProperty(navigator, 'permissions', { configurable: true, value: { query: () => Promise.resolve({ state: permState }) } });
}

beforeEach(() => {
  native = false; permState = 'prompt'; orderRows = [{ id: 'o1', status: 'on_the_way' }];
  rpc.mockReset().mockResolvedValue({ data: { ok: true }, error: null });
  Object.values(nativeGeo).forEach((f: any) => f.mockReset?.());
  nativeGeo.watchPosition.mockResolvedValue('w1'); nativeGeo.clearWatch.mockResolvedValue(undefined);
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
  setupWeb();
});

describe('classification is truthful (not everything is "GPS unavailable")', () => {
  it('maps web error codes and permission state', () => {
    expect(classifyWebError(1, 'denied')).toBe('site_permission_denied');
    expect(classifyWebError(1, 'prompt')).toBe('permission_prompt');
    expect(classifyWebError(2, 'granted')).toBe('position_unavailable');
    expect(classifyWebError(3, 'granted')).toBe('timeout');
    expect(webPreflight({ secure: false, hasGeo: true })).toBe('insecure_context');
    expect(webPreflight({ secure: true, hasGeo: false })).toBe('unsupported');
    expect(classifyNativeError('Location services are not enabled')).toBe('device_location_off');
    expect(classifyNativeError('User denied location permission')).toBe('app_permission_denied');
    expect(new Set(Object.values(GEO_DIAGNOSTIC_CODE)).size).toBe(8);
  });
});

describe('web/PWA flows', () => {
  it('Android GPS on + site permission denied → site_permission_denied, no GPS call until Retry', async () => {
    permState = 'denied';
    const { result } = renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(result.current.problem).toBe('site_permission_denied'));
    expect(getCurrent).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('prompt then allow via Retry gesture: requests immediately, publishes and restarts watch', async () => {
    getCurrent.mockImplementationOnce((_ok: any, err: any) => err({ code: 1 }));
    const { result } = renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(result.current.problem).toBe('permission_prompt'));
    const before = getCurrent.mock.calls.length;
    act(() => { result.current.retry(); });
    expect(getCurrent.mock.calls.length).toBe(before + 1); // synchronous within the tap
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await waitFor(() => expect(watch).toHaveBeenCalled());
  });

  it('timeout then one lower-accuracy recovery (no loop)', async () => {
    getCurrent.mockImplementationOnce((_ok: any, err: any) => err({ code: 3 }));
    renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(getCurrent).toHaveBeenCalledTimes(2);
    expect(getCurrent.mock.calls[1][2]).toMatchObject({ enableHighAccuracy: false, maximumAge: 30_000 });
  });

  it('position unavailable is reported after the bounded 3-step ladder', async () => {
    permState = 'granted';
    getCurrent.mockImplementation((_ok: any, err: any) => err({ code: 2 }));
    const { result } = renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(result.current.problem).toBe('position_unavailable'));
    expect(getCurrent).toHaveBeenCalledTimes(3);
    expect(watch).not.toHaveBeenCalled();
  });

  it('insecure context never calls geolocation', async () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false });
    const { result } = renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(result.current.problem).toBe('insecure_context'));
    expect(getCurrent).not.toHaveBeenCalled();
  });
});

describe('native path uses Capacitor permission APIs, not browser logic', () => {
  it('requests permission and reports app_permission_denied', async () => {
    native = true;
    nativeGeo.checkPermissions.mockResolvedValue({ location: 'prompt', coarseLocation: 'prompt' });
    nativeGeo.requestPermissions.mockResolvedValue({ location: 'denied', coarseLocation: 'denied' });
    const { result } = renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(result.current.problem).toBe('app_permission_denied'));
    expect(nativeGeo.requestPermissions).toHaveBeenCalled();
    expect(getCurrent).not.toHaveBeenCalled();
  });
  it('device location off is distinguished', async () => {
    native = true;
    nativeGeo.checkPermissions.mockRejectedValue(new Error('Location services are not enabled'));
    const { result } = renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(result.current.problem).toBe('device_location_off'));
  });
  it('granted → publishes and watches natively', async () => {
    native = true;
    nativeGeo.checkPermissions.mockResolvedValue({ location: 'granted', coarseLocation: 'granted' });
    nativeGeo.getCurrentPosition.mockResolvedValue(pos());
    renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await waitFor(() => expect(nativeGeo.watchPosition).toHaveBeenCalled());
  });
});

describe('UI and independence', () => {
  it('shows support code, How to enable and Retry for site denial', () => {
    const onRetry = vi.fn();
    render(<RiderTrackingStatus status="problem" problem="site_permission_denied" activeOrderCount={1} onRetry={onRetry} />);
    expect(screen.getByText(/WEB_PERMISSION_DENIED/)).toBeTruthy();
    fireEvent.click(screen.getByText(/How to enable/));
    expect(screen.getByText(/Site settings/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
  it('location tracking never requests notification permission', () => {
    const src = readFileSync('src/hooks/useRiderLiveTracking.ts', 'utf8') + readFileSync('src/lib/riderGeoDiagnostics.ts', 'utf8');
    expect(src).not.toMatch(/Notification|PushNotifications|FirebaseMessaging|usePushNotifications/);
    expect(src).not.toMatch(/console\.(log|info)/);
  });
});

describe('online/assignment gating and recovery', () => {
  it('offline rider with an assignment: no GPS, no error, neutral paused state', async () => {
    const { result } = renderHook(() => useRiderLiveTracking('r', { online: false }));
    await waitFor(() => expect(result.current.status).toBe('paused_offline'));
    expect(result.current.problem).toBeNull();
    expect(getCurrent).not.toHaveBeenCalled();
    render(<RiderTrackingStatus status="paused_offline" activeOrderCount={1} onRetry={() => {}} />);
    expect(screen.getByText(/Live tracking paused — go Online/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('going online resumes and publishes', async () => {
    const { result, rerender } = renderHook(({ on }) => useRiderLiveTracking('r', { online: on }), { initialProps: { on: false } });
    await waitFor(() => expect(result.current.status).toBe('paused_offline'));
    rerender({ on: true });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
  });

  it('going offline stops the watcher', async () => {
    const clear = (navigator.geolocation as any).clearWatch;
    const { rerender } = renderHook(({ on }) => useRiderLiveTracking('r', { online: on }), { initialProps: { on: true } });
    await waitFor(() => expect(watch).toHaveBeenCalled());
    rerender({ on: false });
    expect(clear).toHaveBeenCalledWith(3);
  });

  it('code 2 on cached request recovers via balanced fallback (no high accuracy needed)', async () => {
    getCurrent.mockImplementationOnce((_ok: any, err: any) => err({ code: 2 }));
    renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    expect(getCurrent.mock.calls[0][2]).toMatchObject({ enableHighAccuracy: false, maximumAge: 120_000 });
    expect(getCurrent.mock.calls[1][2]).toMatchObject({ enableHighAccuracy: false });
  });

  it('Retry while offline does not touch GPS', async () => {
    const { result } = renderHook(() => useRiderLiveTracking('r', { online: false }));
    await waitFor(() => expect(result.current.status).toBe('paused_offline'));
    act(() => { result.current.retry(); });
    expect(getCurrent).not.toHaveBeenCalled();
  });

  it('position unavailable auto-recovers on focus / network restore, bounded per event', async () => {
    permState = 'granted';
    getCurrent.mockImplementation((_ok: any, err: any) => err({ code: 2 }));
    const { result } = renderHook(() => useRiderLiveTracking('r'));
    await waitFor(() => expect(result.current.problem).toBe('position_unavailable'));
    expect(getCurrent).toHaveBeenCalledTimes(3);
    getCurrent.mockImplementation((ok: any) => ok(pos()));
    await act(async () => { window.dispatchEvent(new Event('online')); });
    await waitFor(() => expect(rpc).toHaveBeenCalled());
    await waitFor(() => expect(result.current.status).toBe('tracking'));
  });

  it('diagnostics line has no coordinates', () => {
    render(<RiderTrackingStatus status="problem" problem="position_unavailable" activeOrderCount={1} onRetry={() => {}}
      diagnostics={{ online: true, assigned: 1, platform: 'browser', secure: true, lastCode: 'position_unavailable', stage: 'failed' }} />);
    const t = screen.getByTestId('tracking-diagnostics').textContent || '';
    expect(t).toMatch(/online=yes · assigned=1 · browser · secure=yes · last=position_unavailable/);
    expect(t).not.toMatch(/\d+\.\d{3,}/);
    expect(screen.getByText(/POSITION_UNAVAILABLE/)).toBeTruthy();
  });
});
