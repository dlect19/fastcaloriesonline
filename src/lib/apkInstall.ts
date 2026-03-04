import { Capacitor } from '@capacitor/core';
import AppUpdate from '@/plugins/AppUpdatePlugin';

/**
 * Triggers APK download+install.
 * - Native Android Capacitor: uses the AppUpdate plugin (background download + install prompt)
 * - Web browser: opens the URL in a new tab to trigger browser download
 * Returns true if handled (caller should NOT proceed with default <a> behavior).
 */
export async function downloadApk(url: string): Promise<boolean> {
  // Always resolve to absolute URL
  const absoluteUrl = url.startsWith('http')
    ? url
    : `${window.location.origin}${url}`;

  if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
    try {
      await AppUpdate.downloadAndInstall({ url: absoluteUrl });
      return true;
    } catch (e) {
      console.error('Native APK install failed, falling back to browser', e);
      // Fall through to browser method
    }
  }

  // For web (including Capacitor WebView fallback):
  // Use window.open instead of relying on <a download> which doesn't work in WebViews
  try {
    window.open(absoluteUrl, '_system'); // '_system' opens in external browser on Capacitor
    return true;
  } catch {
    // Last resort: direct navigation
    window.location.href = absoluteUrl;
    return true;
  }
}
