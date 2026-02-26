import { Menu, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { RiderSidebar } from './RiderSidebar';
import { ApkUpdateBanner } from '@/components/shared/ApkUpdateBanner';
import riderLogo from '@/assets/rider-logo.png';
import { useState } from 'react';
import { downloadApk } from '@/lib/apkInstall';

interface RiderMobileHeaderProps {
  isOnline: boolean;
  onToggleOnline: (online: boolean) => void;
}

export function RiderMobileHeader({ isOnline, onToggleOnline }: RiderMobileHeaderProps) {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches;
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem('rider_apk_dismissed') === 'true');

  const handleDismiss = () => {
    setDismissed(true);
    sessionStorage.setItem('rider_apk_dismissed', 'true');
  };

  return (
    <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border md:hidden">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <img src={riderLogo} alt="Fast Calories Rider" className="w-12 h-12 object-contain" />
          <div>
            <h1 className="font-bold text-foreground text-sm">Fast Calories</h1>
            <p className="text-[10px] text-muted-foreground">Rider Portal</p>
          </div>
        </div>
        
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="w-5 h-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0 w-64">
            <RiderSidebar isOnline={isOnline} onToggleOnline={onToggleOnline} />
          </SheetContent>
        </Sheet>
      </div>

      {/* Mobile APK download banner */}
      {!isStandalone && !dismissed && (
        <div className="flex items-center gap-2 px-4 py-2 bg-primary/10 border-t border-primary/20">
          <Download className="w-4 h-4 text-primary shrink-0" />
          <p className="text-xs text-foreground flex-1">Get the <strong>Rider App</strong> for a better experience</p>
          <Button asChild size="sm" className="h-7 text-xs shrink-0">
            <a href="/downloads/fastcalories-rider.apk" download onClick={async (e) => { const ok = await downloadApk('/downloads/fastcalories-rider.apk'); if (ok) e.preventDefault(); }}>Download</a>
          </Button>
          <button onClick={handleDismiss} className="text-muted-foreground hover:text-foreground p-1">
            <span className="text-xs">✕</span>
          </button>
        </div>
      )}

      {/* APK Update notification */}
      <ApkUpdateBanner appType="rider" />
    </header>
  );
}
