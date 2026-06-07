/**
 * Web fallback for RiderServicePlugin.
 * 
 * On web/PWA, native foreground services and overlays aren't available.
 * This provides graceful no-op / browser-notification fallbacks.
 */

import { WebPlugin } from '@capacitor/core';
import type {
  RiderServicePluginInterface,
  ForegroundServiceOptions,
  HeadsUpNotificationOptions,
  FloatingOverlayOptions,
} from './RiderServicePlugin';

export class RiderServicePluginWeb
  extends WebPlugin
  implements RiderServicePluginInterface
{
  private _running = false;

  async requestLocationWithDisclosure(): Promise<{
    location: 'granted' | 'denied';
    backgroundLocation: 'granted' | 'denied';
  }> {
    if (!('geolocation' in navigator)) return { location: 'denied', backgroundLocation: 'denied' };
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        () => resolve({ location: 'granted', backgroundLocation: 'denied' }),
        () => resolve({ location: 'denied', backgroundLocation: 'denied' }),
        { timeout: 10000 },
      );
    });
  }

  async startService(): Promise<void> {
    this._running = true;
    console.log('[RiderServicePlugin:Web] startService (simulated)');
  }

  async stopService(): Promise<void> {
    this._running = false;
    console.log('[RiderServicePlugin:Web] stopService (simulated)');
  }


  async startForegroundService(options: ForegroundServiceOptions): Promise<void> {
    this._running = true;
    console.log('[RiderServicePlugin:Web] Foreground service started (simulated):', options.title);

    // Use browser Notification API as fallback if available
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(options.title, { body: options.body, tag: 'rider-foreground' });
    }
  }

  async stopForegroundService(): Promise<void> {
    this._running = false;
    console.log('[RiderServicePlugin:Web] Foreground service stopped (simulated)');
  }

  async isForegroundServiceRunning(): Promise<{ running: boolean }> {
    return { running: this._running };
  }

  async showHeadsUpNotification(options: HeadsUpNotificationOptions): Promise<void> {
    console.log('[RiderServicePlugin:Web] Heads-up notification (simulated):', options);

    // Fallback: use browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(options.title, {
        body: `${options.vendorName} • ₦${options.riderShare.toLocaleString()} • ${options.distanceKm.toFixed(1)}km`,
        tag: `dispatch-${options.offerId}`,
        requireInteraction: true,
      });

      if (options.timeoutSeconds) {
        setTimeout(() => n.close(), options.timeoutSeconds * 1000);
      }
    }
  }

  async dismissHeadsUpNotification(_options: { offerId: string }): Promise<void> {
    console.log('[RiderServicePlugin:Web] Dismiss notification (simulated)');
  }

  async requestOverlayPermission(): Promise<{ granted: boolean }> {
    console.log('[RiderServicePlugin:Web] Overlay permission not available on web');
    return { granted: false };
  }

  async hasOverlayPermission(): Promise<{ granted: boolean }> {
    return { granted: false };
  }

  async showFloatingOverlay(_options: FloatingOverlayOptions): Promise<void> {
    console.log('[RiderServicePlugin:Web] Floating overlay not available on web');
  }

  async updateFloatingOverlay(_options: Partial<FloatingOverlayOptions>): Promise<void> {
    // no-op on web
  }

  async hideFloatingOverlay(): Promise<void> {
    // no-op on web
  }
}
