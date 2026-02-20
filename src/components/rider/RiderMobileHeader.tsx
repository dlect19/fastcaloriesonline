import { Menu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { RiderSidebar } from './RiderSidebar';
import riderLogo from '@/assets/rider-logo.png';

interface RiderMobileHeaderProps {
  isOnline: boolean;
  onToggleOnline: (online: boolean) => void;
}

export function RiderMobileHeader({ isOnline, onToggleOnline }: RiderMobileHeaderProps) {
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
    </header>
  );
}
