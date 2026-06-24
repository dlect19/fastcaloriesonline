import { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { AdminSidebar } from './AdminSidebar';
import { AdminNotificationBell } from './AdminNotificationBell';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { useStaffPresenceHeartbeat } from '@/hooks/useAdminActivityLogger';

interface AdminLayoutProps {
  children: React.ReactNode;
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  useStaffPresenceHeartbeat();

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile top bar */}
      {isMobile && (
        <header className="sticky top-0 z-40 flex items-center justify-between px-4 py-3 bg-card border-b border-border">
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <button className="p-2 rounded-lg hover:bg-secondary" aria-label="Open menu">
                <Menu className="w-5 h-5 text-foreground" />
              </button>
            </SheetTrigger>
            <SheetContent side="left" className="p-0 w-64">
              <div onClick={() => setSidebarOpen(false)}>
                <AdminSidebar />
              </div>
            </SheetContent>
          </Sheet>
          <span className="font-semibold text-foreground text-sm">Admin Portal</span>
          <AdminNotificationBell />
        </header>
      )}

      <div className="flex">
        {/* Desktop sidebar */}
        {!isMobile && (
          <div className="hidden md:block">
            <AdminSidebar />
          </div>
        )}

        {/* Main content */}
        <main className="flex-1 min-w-0">
          {/* Desktop notification bar */}
          {!isMobile && (
            <div className="sticky top-0 z-30 flex items-center justify-end px-6 py-2 bg-card/80 backdrop-blur-sm border-b border-border">
              <AdminNotificationBell />
            </div>
          )}
          <div className="p-4 md:p-8">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
