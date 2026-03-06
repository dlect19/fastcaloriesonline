import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

interface ApkUpdateInfo {
  hasUpdate: boolean;
  version: string;
  changelog: string;
  downloadUrl: string;
}

/**
 * Compares two semver strings. Returns:
 *  -1 if a < b, 0 if equal, 1 if a > b
 */
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

export function useApkUpdateCheck(appType: 'customer' | 'rider' | 'vendor') {
  const [updateInfo, setUpdateInfo] = useState<ApkUpdateInfo | null>(null);

  useEffect(() => {
    const versionKey = `${appType}_apk_version`;
    const changelogKey = `${appType}_apk_changelog`;
    const downloadUrlKey = `${appType}_apk_download_url`;

    const checkUpdate = async () => {
      // Get the currently installed app version
      let currentVersion = '0.0.0';
      if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
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
        .in('key', [versionKey, changelogKey, downloadUrlKey]);

      if (error || !data) return;

      const latestVersion = data.find(d => d.key === versionKey)?.value || '1.0.0';
      const changelog = data.find(d => d.key === changelogKey)?.value || 'Performance improvements';
      const downloadUrl = data.find(d => d.key === downloadUrlKey)?.value
        || `/downloads/fastcalories-${appType}.apk`;

      // On native: compare actual installed version vs latest
      if (Capacitor.isNativePlatform()) {
        if (compareSemver(currentVersion, latestVersion) >= 0) return; // already up to date
      } else {
        // On web: use localStorage dismiss approach
        const dismissedVersion = localStorage.getItem(`${appType}_apk_dismissed_version`);
        if (dismissedVersion === latestVersion) return;
      }

      setUpdateInfo({ hasUpdate: true, version: latestVersion, changelog, downloadUrl });
    };

    checkUpdate();
  }, [appType]);

  const dismiss = (version: string) => {
    localStorage.setItem(`${appType}_apk_dismissed_version`, version);
    setUpdateInfo(null);
  };

  return { updateInfo, dismiss };
}
