/**
 * Authoritative Capacitor runtime detection for location routing.
 *
 * Native status comes only from the Capacitor bridge (Capacitor.isNativePlatform /
 * getPlatform, which read the injected window.androidBridge or the iOS
 * webkit.messageHandlers.bridge). The page URL, scheme, hostname, display mode
 * or user agent never make a context "native": a Capacitor WebView serving
 * https://app.fastcalories.online is native because its bridge is present.
 *
 * `shellWithoutBridge` is a display-only hint (Android WebView marker with no
 * bridge): the installed app shell is loading this page on an origin it does
 * not inject the bridge into, so the rider needs an app update — it is never
 * used to route calls to native plugins.
 */
import { Capacitor } from '@capacitor/core';

export type RuntimePlatform = 'android' | 'ios' | 'web';

export interface RuntimeInfo {
  platform: RuntimePlatform;
  /** Capacitor native bridge present (calls can reach native plugins). */
  bridge: boolean;
  /** @capacitor/geolocation registered in the native shell. */
  geolocationPlugin: boolean;
  /** App WebView without a bridge → installed shell outdated/misconfigured. */
  shellWithoutBridge: boolean;
}

type CapLike = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
  isPluginAvailable?: (name: string) => boolean;
};

const safe = <T>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };

export function detectRuntime(
  win: any = typeof window === 'undefined' ? undefined : window,
  cap: CapLike = Capacitor as unknown as CapLike,
): RuntimeInfo {
  const rawBridge: RuntimePlatform | null = win?.androidBridge
    ? 'android'
    : win?.webkit?.messageHandlers?.bridge ? 'ios' : null;
  const capNative = safe(() => !!cap.isNativePlatform?.(), false);
  const capPlatform = safe(() => cap.getPlatform?.(), undefined) as string | undefined;
  const bridge = capNative || !!rawBridge;
  const platform: RuntimePlatform = !bridge
    ? 'web'
    : capPlatform === 'android' || capPlatform === 'ios' ? capPlatform : (rawBridge ?? 'android');
  // Older cores without isPluginAvailable: assume registered, the call probe decides.
  const geolocationPlugin = bridge && safe(
    () => (typeof cap.isPluginAvailable === 'function' ? cap.isPluginAvailable('Geolocation') : true),
    false,
  );
  const ua = String(win?.navigator?.userAgent || '');
  const shellWithoutBridge = !bridge && /; wv\)/.test(ua);
  return { platform, bridge, geolocationPlugin, shellWithoutBridge };
}

/** Native routing is allowed only with a bridge and the geolocation plugin. */
export function useNativeGeolocation(r: RuntimeInfo): boolean {
  return r.bridge && r.platform !== 'web' && r.geolocationPlugin;
}

/** Plugin call failed because the native implementation is not in this shell. */
export function isUnimplementedError(e: any): boolean {
  const code = String(e?.code || '');
  const msg = String(e?.message || e || '').toLowerCase();
  return code === 'UNIMPLEMENTED' || /not implemented|plugin is not implemented|not available on this platform/.test(msg);
}
