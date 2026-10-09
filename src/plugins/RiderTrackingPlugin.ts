/**
 * Bridge to the rider Android target's native RiderTrackingService (android-rider only).
 * Not registered in the customer app or on web/iOS — callers must check isNativeRiderTrackingAvailable().
 */
import { registerPlugin } from '@capacitor/core';

export interface NativeTrackingStatus {
  running: boolean; activeOrders: number; lastUploadAt: number; acceptedCount: number;
  lastError: string | null; locationGranted: boolean;
}
export interface RiderTrackingPluginApi {
  start(o: { supabaseUrl: string; anonKey: string; expiresAt: number; orders: { orderId: string; token: string }[] }): Promise<{ started: boolean }>;
  stop(): Promise<void>;
  getStatus(): Promise<NativeTrackingStatus>;
  requestPermissions(o: { permissions: ('location' | 'notifications')[] }): Promise<Record<string, string>>;
}
export const RiderTracking = registerPlugin<RiderTrackingPluginApi>('RiderTracking');
