/**
 * Pure decisions for native background rider tracking (android-rider RiderTrackingService).
 * The native service uploads on its own while JS is suspended; JS only starts it (while
 * visible), refreshes its per-delivery tokens, and stops it. Never both JS and native.
 */
import { Capacitor } from '@capacitor/core';

type CapLike = { getPlatform?: () => string; isPluginAvailable?: (n: string) => boolean };

export function isNativeRiderTrackingAvailable(cap: CapLike = Capacitor as unknown as CapLike): boolean {
  try { return cap.getPlatform?.() === 'android' && !!cap.isPluginAvailable?.('RiderTracking'); } catch { return false; }
}

/** Refresh tokens this long before they expire (server issues 4 h tokens). */
export const TOKEN_REFRESH_MARGIN_MS = 30 * 60_000;
export const NATIVE_STATUS_POLL_MS = 15_000;
export const NATIVE_MAX_RESTARTS = 3;

export type NativeAction = 'start' | 'stop' | 'noop';

/**
 * - inactive (offline, no authorised delivery, logged out, kill switch) → stop if running/started
 * - active: (re)start only while visible (Android forbids starting a location FGS from background)
 *   when the delivery set changed, tokens near expiry, or the service died — bounded restarts.
 */
export function planNativeTracking(s: {
  active: boolean; visible: boolean; running: boolean; startedKey: string | null; ordersKey: string;
  expiresAt: number; now: number; restarts: number;
}): NativeAction {
  if (!s.active) return s.running || s.startedKey ? 'stop' : 'noop';
  if (!s.visible) return 'noop';
  if (s.startedKey !== s.ordersKey) return 'start';
  if (s.expiresAt - s.now < TOKEN_REFRESH_MARGIN_MS) return 'start';
  if (!s.running) return s.restarts < NATIVE_MAX_RESTARTS ? 'start' : 'noop';
  return 'noop';
}

export const ordersKeyOf = (orders: { id: string }[]) => orders.map((o) => o.id).sort().join(',');
