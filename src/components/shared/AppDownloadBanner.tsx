import { useState } from 'react';
import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Capacitor } from '@capacitor/core';

interface AppDownloadBannerProps {
  appType: 'customer' | 'rider' | 'vendor';
  label?: string;
}

const GET_APP_URL = 'https://app.fastcalories.online/get-app';

export function AppDownloadBanner({ appType, label }: AppDownloadBannerProps) {
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem(`${appType}_download_banner_dismissed`) === 'true';
  });

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const isNative = Capacitor.isNativePlatform();

  // Hide on native app (already installed) or installed PWA
  if (isNative || isStandalone || dismissed) return null;

  const appLabels: Record<string, string> = {
    customer: 'Customer',
    rider: 'Rider',
    vendor: 'Vendor',
  };

  const displayLabel = label || appLabels[appType];

  const handleGetApp = () => {
    window.open(GET_APP_URL, '_blank', 'noopener,noreferrer');
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
      <Button size="sm" className="shrink-0 h-8 text-xs" onClick={handleGetApp}>
        <Download className="w-3.5 h-3.5 mr-1" />
        Get App
      </Button>
      <button onClick={handleDismiss} className="shrink-0 p-1 text-muted-foreground hover:text-foreground">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
