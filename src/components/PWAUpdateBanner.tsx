import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { usePWAUpdate } from '@/hooks/usePWAUpdate';

export function PWAUpdateBanner() {
  const { showUpdateBanner, applyUpdate, dismissUpdate } = usePWAUpdate();

  if (!showUpdateBanner) return null;

  return (
    <div className="fixed top-0 left-0 right-0 z-[100] bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between gap-3 shadow-lg animate-in slide-in-from-top">
      <div className="flex items-center gap-2 text-sm font-medium">
        <RefreshCw className="w-4 h-4 animate-spin" />
        <span>A new version is available!</span>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-primary-foreground hover:bg-primary-foreground/20 text-xs h-7"
          onClick={dismissUpdate}
        >
          Later
        </Button>
        <Button
          size="sm"
          className="bg-primary-foreground text-primary hover:bg-primary-foreground/90 text-xs h-7"
          onClick={applyUpdate}
        >
          Update Now
        </Button>
      </div>
    </div>
  );
}
