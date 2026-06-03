import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';

/**
 * Opens a payment / external URL.
 * - On native (iOS/Android): uses Capacitor Browser (in-app browser tab, no Chrome handoff)
 * - On web: falls back to window.location.href
 */
export async function openPaymentUrl(url: string) {
  if (Capacitor.isNativePlatform()) {
    try {
      await Browser.open({
        url,
        presentationStyle: 'fullscreen',
        windowName: '_self',
      });
      return;
    } catch (err) {
      console.error('Capacitor Browser failed, falling back:', err);
    }
  }
  window.location.href = url;
}
