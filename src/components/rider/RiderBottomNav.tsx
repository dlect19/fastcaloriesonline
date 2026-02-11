import { useNavigate, useLocation } from 'react-router-dom';
import { Home, Package, DollarSign, Settings, Power, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
import fastCaloriesFooterLogo from '@/assets/fast-calories-footer-logo.png';

interface RiderBottomNavProps {
  isOnline?: boolean;
  onToggleOnline?: (online: boolean) => void;
  canViewEarnings?: boolean;
}

export function RiderBottomNav({ isOnline = false, onToggleOnline, canViewEarnings = true }: RiderBottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();

  // Build nav items based on permissions
  const navItems = [
    { id: 'dashboard', icon: Home, label: 'Home', path: '/rider/dashboard' },
    { id: 'orders', icon: Package, label: 'My Orders', path: '/rider/orders' },
    { id: 'available', icon: Package, label: 'Available', path: '/rider/available' },
    ...(canViewEarnings ? [
      { id: 'earnings', icon: DollarSign, label: 'Earnings', path: '/rider/earnings' },
    ] : []),
    { id: 'support', icon: MessageSquare, label: 'Support', path: '/rider/support' },
    { id: 'settings', icon: Settings, label: 'Settings', path: '/rider/settings' },
  ];

  const currentTab = navItems.find(item => item.path === location.pathname)?.id || 'dashboard';

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border safe-bottom z-50 md:hidden">
      {/* Footer logo */}
      <div className="flex justify-center py-1.5 border-b border-border/50">
        <img src={fastCaloriesFooterLogo} alt="Fast Calories" className="h-6 w-auto" />
      </div>
      {/* Online status bar */}
      <div className="flex items-center justify-center gap-3 py-2 px-4 border-b border-border bg-secondary/50">
        <Power className={cn("w-4 h-4", isOnline ? "text-calorie-low" : "text-muted-foreground")} />
        <span className="text-sm font-medium">{isOnline ? 'Online' : 'Offline'}</span>
        <Switch checked={isOnline} onCheckedChange={onToggleOnline} />
      </div>
      
      {/* Navigation items */}
      <div className="flex items-center justify-around py-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;

          return (
            <button
              key={item.id}
              onClick={() => navigate(item.path)}
              className={cn(
                'flex flex-col items-center gap-1 py-2 px-3 rounded-xl transition-colors min-w-0',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon
                className={cn(
                  'w-5 h-5 transition-all',
                  isActive && 'scale-110'
                )}
                fill={isActive ? 'currentColor' : 'none'}
              />
              <span className="text-[10px] font-medium truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
