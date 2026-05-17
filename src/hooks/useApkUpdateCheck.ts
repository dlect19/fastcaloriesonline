import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

interface ApkUpdateInfo {
  hasUpdate: boolean;
  version: string;
  changelog: string;
  downloadUrl: string;
  platform: 'android' | 'ios';
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}

/**
 * Detect target store platform.
 * - Native app: uses its actual platform
 * - Web/PWA: detects iOS vs Android via user agent (defaults to android)
 */
function detectPlatform(): 'android' | 'ios' {
  if (Capacitor.isNativePlatform()) {
    return Capacitor.getPlatform() === 'ios' ? 'ios' : 'android';
  }
  const ua = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/i.test(ua)) return 'ios';
  return 'android';
}

export function useApkUpdateCheck(appType: 'customer' | 'rider' | 'vendor') {
  const [updateInfo, setUpdateInfo] = useState<ApkUpdateInfo | null>(null);

  useEffect(() => {
    const platform = detectPlatform();
    const versionKey = `${appType}_apk_version`;
    const changelogKey = `${appType}_apk_changelog`;
    const androidUrlKey = `${appType}_apk_download_url`;
    const iosUrlKey = `${appType}_ios_app_url`;

    const checkUpdate = async () => {
      // Get the currently installed app version (native only)
      let currentVersion = '0.0.0';
      if (Capacitor.isNativePlatform()) {
        try {
          const { App } = await import('@capacitor/app');
          const info = await App.getInfo();
          currentVersion = info.version || '0.0.0';
        } catch {
          const meta = document.querySelector('meta[name="app-version"]');
          if (meta) currentVersion = meta.getAttribute('content') || '0.0.0';
        }
      }

      const { data, error } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', [versionKey, changelogKey, androidUrlKey, iosUrlKey]);

      if (error || !data) return;

      const latestVersion = data.find(d => d.key === versionKey)?.value || '1.0.0';
      const changelog = data.find(d => d.key === changelogKey)?.value || 'Performance improvements';
      const androidUrl = data.find(d => d.key === androidUrlKey)?.value || '';
      const iosUrl = data.find(d => d.key === iosUrlKey)?.value || '';

      const downloadUrl = platform === 'ios' ? iosUrl : androidUrl;
      if (!downloadUrl) return; // no link configured for this platform

      // Native: compare installed version vs latest
      if (Capacitor.isNativePlatform()) {
        if (compareSemver(currentVersion, latestVersion) >= 0) return;
      }

      // Permanent dismiss after user clicks "Update"
      const clickedVersion = localStorage.getItem(`${appType}_apk_clicked_version`);
      if (clickedVersion === latestVersion) return;

      // Per-version dismiss via X button
      const dismissedVersion = localStorage.getItem(`${appType}_apk_dismissed_version`);
      if (dismissedVersion === latestVersion) return;

      setUpdateInfo({ hasUpdate: true, version: latestVersion, changelog, downloadUrl, platform });
    };

    checkUpdate();
  }, [appType]);

  const dismiss = (version: string) => {
    localStorage.setItem(`${appType}_apk_dismissed_version`, version);
    setUpdateInfo(null);
  };

  const markClicked = (version: string) => {
    localStorage.setItem(`${appType}_apk_clicked_version`, version);
    setUpdateInfo(null);
  };

  return { updateInfo, dismiss, markClicked };
}
