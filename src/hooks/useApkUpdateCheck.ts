import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface ApkUpdateInfo {
  hasUpdate: boolean;
  version: string;
  changelog: string;
  downloadUrl: string;
}

export function useApkUpdateCheck(appType: 'customer' | 'rider' | 'vendor') {
  const [updateInfo, setUpdateInfo] = useState<ApkUpdateInfo | null>(null);

  useEffect(() => {
    const versionKey = `${appType}_apk_version`;
    const changelogKey = `${appType}_apk_changelog`;
    const localStorageKey = `${appType}_apk_dismissed_version`;
    const downloadUrl = appType === 'rider'
      ? '/downloads/fastcalories-rider.apk'
      : appType === 'vendor'
      ? '/downloads/fastcalories-vendor.apk'
      : '/downloads/fastcalories-customer.apk';

    const checkUpdate = async () => {
      const { data, error } = await supabase
        .from('platform_settings')
        .select('key, value')
        .in('key', [versionKey, changelogKey]);

      if (error || !data) return;

      const version = data.find(d => d.key === versionKey)?.value || '1.0.0';
      const changelog = data.find(d => d.key === changelogKey)?.value || 'Performance improvements';

      const dismissedVersion = localStorage.getItem(localStorageKey);
      if (dismissedVersion === version) return;

      setUpdateInfo({ hasUpdate: true, version, changelog, downloadUrl });
    };

    checkUpdate();
  }, [appType]);

  const dismiss = (version: string) => {
    localStorage.setItem(`${appType}_apk_dismissed_version`, version);
    setUpdateInfo(null);
  };

  return { updateInfo, dismiss };
}
