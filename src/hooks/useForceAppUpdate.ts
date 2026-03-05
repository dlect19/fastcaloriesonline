import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';

interface ForceUpdateState {
  required: boolean;
  currentVersion: string;
  latestVersion: string;
  downloadUrl: string;
  changelog: string;
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

/**
 * Detects the app type based on the current URL path.
 */
function detectAppType(): 'customer' | 'vendor' | 'rider' | null {
  const path = window.location.pathname;
  if (path.startsWith('/vendor')) return 'vendor';
  if (path.startsWith('/rider')) return 'rider';
  // Admin and delivery portals are web-only, skip force update
  if (path.startsWith('/admin') || path.startsWith('/delivery')) return null;
  return 'customer';
}

/**
 * On native Capacitor (Android), checks if the installed APK version
 * is below the minimum required version in platform_settings.
 * If so, returns { required: true } to force the user to update.
 */
export function useForceAppUpdate() {
  const [state, setState] = useState<ForceUpdateState>({
    required: false,
    currentVersion: '',
    latestVersion: '',
    downloadUrl: '',
    changelog: '',
  });

  useEffect(() => {
    const check = async () => {
      // Only enforce on native Android
      if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;

      const appType = detectAppType();
      if (!appType) return;

      // Get native app version
      let currentVersion = '0.0.0';
      try {
        const { App } = await import('@capacitor/app');
        const info = await App.getInfo();
        currentVersion = info.version || '0.0.0';
      } catch {
        // Plugin not available, try meta tag fallback
        const meta = document.querySelector('meta[name="app-version"]');
        if (meta) currentVersion = meta.getAttribute('content') || '0.0.0';
        else return; // Can't determine version, skip
      }

      // Fetch required version from platform_settings
      const versionKey = `${appType}_apk_version`;
      const changelogKey = `${appType}_apk_changelog`;
      const downloadUrlKey = `${appType}_apk_download_url`;
      const forceUpdateKey = `${appType}_force_update_min_version`;

      const { data } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', [versionKey, changelogKey, downloadUrlKey, forceUpdateKey]);

      if (!data || data.length === 0) return;

      const latestVersion = data.find(d => d.key === versionKey)?.value || '1.0.0';
      const minRequired = data.find(d => d.key === forceUpdateKey)?.value || latestVersion;
      const changelog = data.find(d => d.key === changelogKey)?.value || 'Bug fixes and improvements';
      const downloadUrl = data.find(d => d.key === downloadUrlKey)?.value
        || `/downloads/fastcalories-${appType}.apk`;

      // If current version is below minimum required, force update
      if (compareSemver(currentVersion, minRequired) < 0) {
        setState({
          required: true,
          currentVersion,
          latestVersion,
          downloadUrl,
          changelog,
        });
      }
    };

    check();
    // Re-check every 5 minutes
    const interval = setInterval(check, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  return state;
}
