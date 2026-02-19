/**
 * Capacitor Plugin Interface: RiderServicePlugin
 * 
 * This defines the TypeScript bridge for native Android features:
 * 1. Foreground Service (persistent notification when online)
 * 2. Heads-up notifications with Accept/Reject actions
 * 3. Floating overlay bubble (optional)
 * 
 * NATIVE IMPLEMENTATION REQUIRED:
 * After exporting to GitHub and running `npx cap add android`,
 * implement the native Kotlin plugin in:
 *   android/app/src/main/java/app/lovable/.../plugins/RiderServicePlugin.kt
 */

import { registerPlugin } from '@capacitor/core';

export interface ForegroundServiceOptions {
  title: string;
  body: string;
  /** Android notification channel ID */
  channelId?: string;
}

export interface HeadsUpNotificationOptions {
  title: string;
  body: string;
  /** Delivery fee to display */
  deliveryFee: number;
  /** Distance in km */
  distanceKm: number;
  /** Vendor name */
  vendorName: string;
  /** Dispatch offer ID for accept/reject actions */
  offerId: string;
  /** Rider share amount */
  riderShare: number;
  /** Auto-dismiss timeout in seconds */
  timeoutSeconds?: number;
}

export interface FloatingOverlayOptions {
  /** Order number to display */
  orderNumber: string;
  /** Vendor name */
  vendorName: string;
  /** Current status label */
  statusLabel: string;
  /** Delivery fee */
  deliveryFee: number;
  /** Distance in km */
  distanceKm: number;
}

export interface RiderServicePluginInterface {
  /**
   * Start the foreground service with a persistent notification.
   * Called when rider goes ONLINE.
   */
  startForegroundService(options: ForegroundServiceOptions): Promise<void>;

  /**
   * Stop the foreground service.
   * Called when rider goes OFFLINE.
   */
  stopForegroundService(): Promise<void>;

  /**
   * Check if the foreground service is currently running.
   */
  isForegroundServiceRunning(): Promise<{ running: boolean }>;

  /**
   * Show a heads-up notification for a new dispatch offer.
   * Includes ACCEPT and REJECT action buttons.
   */
  showHeadsUpNotification(options: HeadsUpNotificationOptions): Promise<void>;

  /**
   * Dismiss the heads-up notification (e.g., when offer expires).
   */
  dismissHeadsUpNotification(options: { offerId: string }): Promise<void>;

  /**
   * Request SYSTEM_ALERT_WINDOW permission for floating overlay.
   * Returns whether permission was granted.
   */
  requestOverlayPermission(): Promise<{ granted: boolean }>;

  /**
   * Check if overlay permission is granted.
   */
  hasOverlayPermission(): Promise<{ granted: boolean }>;

  /**
   * Show the floating overlay bubble.
   */
  showFloatingOverlay(options: FloatingOverlayOptions): Promise<void>;

  /**
   * Update the floating overlay with new data.
   */
  updateFloatingOverlay(options: Partial<FloatingOverlayOptions>): Promise<void>;

  /**
   * Hide the floating overlay bubble.
   */
  hideFloatingOverlay(): Promise<void>;

  /**
   * Register a listener for native action events (e.g., Accept/Reject button taps).
   */
  addListener(
    eventName: 'dispatchAction',
    callback: (data: { action: 'accept' | 'reject'; offerId: string }) => void,
  ): Promise<{ remove: () => void }>;

  /**
   * Register a listener for overlay tap events.
   */
  addListener(
    eventName: 'overlayTapped',
    callback: () => void,
  ): Promise<{ remove: () => void }>;

  /**
   * Register a listener for foreground notification toggle-offline tap.
   */
  addListener(
    eventName: 'toggleOffline',
    callback: () => void,
  ): Promise<{ remove: () => void }>;

  /**
   * Remove all listeners.
   */
  removeAllListeners(): Promise<void>;
}

/**
 * The plugin instance. On web, this uses the WebFallback below.
 * On Android, it bridges to the native Kotlin implementation.
 */
const RiderServicePlugin = registerPlugin<RiderServicePluginInterface>(
  'RiderServicePlugin',
  {
    web: () => import('./RiderServicePluginWeb').then(m => new m.RiderServicePluginWeb()),
  },
);

export default RiderServicePlugin;
