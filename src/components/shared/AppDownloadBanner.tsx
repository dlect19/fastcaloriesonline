import { useState, useEffect } from 'react';
import { Download, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { downloadApk } from '@/lib/apkInstall';

interface AppDownloadBannerProps {
  appType: 'customer' | 'rider' | 'vendor';
  label?: string;
}

export function AppDownloadBanner({ appType, label }: AppDownloadBannerProps) {
  const [downloadUrl, setDownloadUrl] = useState<string>(`/downloads/fastcalories-${appType}.apk`);
  const [downloading, setDownloading] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem(`${appType}_download_banner_dismissed`) === 'true';
  });

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    const key = `${appType}_apk_download_url`;
    supabase
      .from('platform_settings')
      .select('value')
      .eq('key', key)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.value) setDownloadUrl(data.value);
      });
  }, [appType]);

  // Don't show on native or standalone (already installed)
  if (isNative || isStandalone || dismissed) return null;

  const appLabels: Record<string, string> = {
    customer: 'Customer',
    rider: 'Rider',
    vendor: 'Vendor',
  };

  const displayLabel = label || appLabels[appType];

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadApk(downloadUrl);
    } finally {
      setTimeout(() => setDownloading(false), 3000);
    }
  };

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem(`${appType}_download_banner_dismissed`, 'true');
  };

  return (
    <div className="mx-4 mt-3 p-3 bg-primary/10 border border-primary/20 rounded-xl flex items-center gap-3 animate-in slide-in-from-top">
      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
        <Download className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">Download {displayLabel} App</p>
        <p className="text-xs text-muted-foreground">Get faster experience & instant notifications</p>
      </div>
      <Button size="sm" className="shrink-0 h-8 text-xs" disabled={downloading} onClick={handleDownload}>
        {downloading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Download className="w-3.5 h-3.5 mr-1" />}
        {downloading ? 'Opening...' : 'Get App'}
      </Button>
      <button onClick={handleDismiss} className="shrink-0 p-1 text-muted-foreground hover:text-foreground">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
