import { Capacitor } from '@capacitor/core';
import AppUpdate from '@/plugins/AppUpdatePlugin';

/**
 * Triggers APK download+install natively on Android Capacitor,
 * or falls back to a regular browser download on web.
 */
export async function downloadApk(url: string): Promise<boolean> {
  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      // Resolve relative URLs to absolute
      const absoluteUrl = url.startsWith('http')
        ? url
        : `${window.location.origin}${url}`;
      await AppUpdate.downloadAndInstall({ url: absoluteUrl });
      return true; // handled natively
    } catch (e) {
      console.error('Native APK install failed, falling back to browser download', e);
    }
  }
  return false; // not handled, caller should use default <a> behavior
}
