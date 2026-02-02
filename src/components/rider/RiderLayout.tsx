import { ReactNode } from 'react';
import { RiderSidebar } from './RiderSidebar';
import { RiderBottomNav } from './RiderBottomNav';
import { RiderMobileHeader } from './RiderMobileHeader';
import { useIsMobile } from '@/hooks/use-mobile';

interface RiderLayoutProps {
  children: ReactNode;
  isOnline: boolean;
  onToggleOnline: (online: boolean) => void;
  canViewEarnings?: boolean;
}

export function RiderLayout({ children, isOnline, onToggleOnline, canViewEarnings = true }: RiderLayoutProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <RiderMobileHeader isOnline={isOnline} onToggleOnline={onToggleOnline} />
        <main className="flex-1 p-4 pb-36">
          {children}
        </main>
        <RiderBottomNav isOnline={isOnline} onToggleOnline={onToggleOnline} canViewEarnings={canViewEarnings} />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex">
      <RiderSidebar isOnline={isOnline} onToggleOnline={onToggleOnline} canViewEarnings={canViewEarnings} />
      <main className="flex-1 p-8">
        {children}
      </main>
    </div>
  );
}
