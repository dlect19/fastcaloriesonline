import { useNavigate, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  UtensilsCrossed,
  ShoppingBag,
  Star,
  Wallet,
  ArrowUpRight,
  Clock,
  Settings,
  LogOut,
  Store,
  ChevronLeft,
  Menu,
  Ticket,
  Users,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useState } from 'react';
import { VendorPermission } from '@/hooks/useVendorPermissions';

// Map nav items to required permissions
const navItems: { 
  id: string; 
  icon: typeof LayoutDashboard; 
  label: string; 
  path: string;
  permission?: VendorPermission;
}[] = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard', path: '/vendor/dashboard', permission: 'view_dashboard' },
  { id: 'menu', icon: UtensilsCrossed, label: 'Menu', path: '/vendor/menu', permission: 'manage_menu' },
  { id: 'orders', icon: ShoppingBag, label: 'Orders', path: '/vendor/orders', permission: 'process_orders' },
  { id: 'promos', icon: Ticket, label: 'Promos', path: '/vendor/promos', permission: 'manage_promos' },
  { id: 'riders', icon: Users, label: 'My Riders', path: '/vendor/riders', permission: 'manage_riders' },
  { id: 'staff', icon: Users, label: 'Staff', path: '/vendor/staff', permission: 'manage_staff' },
  { id: 'reviews', icon: Star, label: 'Reviews', path: '/vendor/reviews', permission: 'view_dashboard' },
  { id: 'earnings', icon: Wallet, label: 'Earnings', path: '/vendor/earnings', permission: 'view_earnings' },
  { id: 'withdraw', icon: ArrowUpRight, label: 'Withdraw', path: '/vendor/withdraw', permission: 'request_withdrawal' },
  { id: 'hours', icon: Clock, label: 'Working Hours', path: '/vendor/hours', permission: 'edit_settings' },
  { id: 'support', icon: MessageSquare, label: 'Support', path: '/vendor/support' },
  { id: 'settings', icon: Settings, label: 'Settings', path: '/vendor/settings', permission: 'edit_settings' },
];

interface VendorSidebarProps {
  vendorName?: string;
  permissions?: VendorPermission[];
}

export function VendorSidebar({ vendorName = 'My Restaurant', permissions = [] }: VendorSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/vendor/auth');
  };

  // Filter nav items based on user permissions
  // If no permissions are passed (owner/loading), show all items
  const visibleItems = permissions.length > 0 
    ? navItems.filter(item => !item.permission || permissions.includes(item.permission))
    : navItems;

  return (
    <>
      {/* Mobile Header */}
      <header className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-background border-b border-border h-14 flex items-center px-4">
        <Button variant="ghost" size="icon" onClick={() => setCollapsed(!collapsed)}>
          <Menu className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2 ml-3">
          <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
            <Store className="w-5 h-5 text-primary-foreground" />
          </div>
          <span className="font-semibold text-sm truncate">{vendorName}</span>
        </div>
      </header>

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-screen bg-card border-r border-border transition-all duration-300',
          collapsed ? 'w-16' : 'w-64',
          'lg:translate-x-0',
          collapsed ? '-translate-x-full lg:translate-x-0' : 'translate-x-0'
        )}
      >
        {/* Logo */}
        <div className="h-16 flex items-center justify-between px-4 border-b border-border">
          {!collapsed && (
            <div className="flex items-center gap-2">
              <div className="w-12 h-12 rounded-xl bg-primary flex items-center justify-center">
                <Store className="w-6 h-6 text-primary-foreground" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm truncate">{vendorName}</p>
                <p className="text-xs text-muted-foreground">Vendor Portal</p>
              </div>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:flex"
            onClick={() => setCollapsed(!collapsed)}
          >
            <ChevronLeft className={cn('w-4 h-4 transition-transform', collapsed && 'rotate-180')} />
          </Button>
        </div>

        {/* Navigation */}
        <nav className="p-3 space-y-1">
          {visibleItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path;

            return (
              <button
                key={item.id}
                onClick={() => {
                  navigate(item.path);
                  if (window.innerWidth < 1024) setCollapsed(true);
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors text-left',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                )}
              >
                <Icon className="w-5 h-5 flex-shrink-0" />
                {!collapsed && <span className="text-sm font-medium">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        {/* Logout */}
        <div className="absolute bottom-0 left-0 right-0 p-3 border-t border-border">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="text-sm font-medium">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile Overlay */}
      {!collapsed && (
        <div
          className="lg:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setCollapsed(true)}
        />
      )}
    </>
  );
}
