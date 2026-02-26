import { Download, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export function PWAInstallBanner() {
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem('pwa_banner_dismissed') === 'true';
  });
  const navigate = useNavigate();

  // Check if already in standalone/native mode
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;

  if (isStandalone || dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('pwa_banner_dismissed', 'true');
  };

  return (
    <div className="mx-4 mt-3 p-3 bg-primary/10 border border-primary/20 rounded-xl flex items-center gap-3 animate-in slide-in-from-top">
      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
        <Download className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">Download Our App</p>
        <p className="text-xs text-muted-foreground">Get faster ordering & instant notifications</p>
      </div>
      <Button size="sm" className="shrink-0 h-8 text-xs" onClick={() => navigate('/install')}>
        Get App
      </Button>
      <button onClick={handleDismiss} className="shrink-0 p-1 text-muted-foreground hover:text-foreground">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
