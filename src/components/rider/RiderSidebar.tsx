import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Package, DollarSign, ArrowUpRight, Settings, LogOut, Power, MessageSquare } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

interface RiderSidebarProps {
  isOnline?: boolean;
  onToggleOnline?: (online: boolean) => void;
  canViewEarnings?: boolean;
}

export function RiderSidebar({ isOnline = false, onToggleOnline, canViewEarnings = true }: RiderSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [availableCount, setAvailableCount] = useState(0);

  // Fetch and subscribe to pending dispatch offers count
  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;

    const setup = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const fetchCount = async () => {
        const { count, error } = await supabase
          .from('dispatch_offers')
          .select('*', { count: 'exact', head: true })
          .eq('rider_user_id', user.id)
          .eq('status', 'pending')
          .gt('expires_at', new Date().toISOString());
        if (!error && count !== null) setAvailableCount(count);
      };

      fetchCount();

      channel = supabase
        .channel('rider-sidebar-offers')
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'dispatch_offers',
          filter: `rider_user_id=eq.${user.id}`,
        }, () => fetchCount())
        .subscribe();
    };

    setup();
    return () => { if (channel) supabase.removeChannel(channel); };
  }, []);

  // Build menu items based on permissions
  const menuItems = [
    { icon: Home, label: 'Dashboard', path: '/rider/dashboard' },
    { icon: Package, label: 'My Deliveries', path: '/rider/orders' },
    { icon: Package, label: 'Available Orders', path: '/rider/available-orders' },
    ...(canViewEarnings ? [
      { icon: DollarSign, label: 'Earnings', path: '/rider/earnings' },
      { icon: ArrowUpRight, label: 'Withdraw', path: '/rider/withdraw' },
    ] : []),
    { icon: MessageSquare, label: 'Support', path: '/rider/support' },
    { icon: Settings, label: 'Settings', path: '/rider/settings' },
  ];

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast({ title: 'Logged out successfully' });
    navigate('/rider/auth');
  };

  return (
    <aside className="w-64 min-h-screen bg-card border-r border-border flex flex-col">
      {/* Logo Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <img src={fastCaloriesLogo} alt="Fast Calories" className="w-14 h-14 object-contain" />
          <div>
            <h1 className="font-bold text-foreground">Fast Calories</h1>
            <p className="text-xs text-muted-foreground">Rider Portal</p>
          </div>
        </div>
      </div>

      {/* Online Status Toggle */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary">
          <div className="flex items-center gap-2">
            <Power className={cn("w-4 h-4", isOnline ? "text-calorie-low" : "text-muted-foreground")} />
            <span className="text-sm font-medium">{isOnline ? 'Online' : 'Offline'}</span>
          </div>
          <Switch checked={isOnline} onCheckedChange={onToggleOnline} />
        </div>
      </div>

      {/* Navigation */}
      <nav className="p-4">
        <ul className="space-y-2">
          {menuItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <li key={item.path}>
                <button
                  onClick={() => navigate(item.path)}
                  className={cn(
                    "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  )}
                >
                  <item.icon className="w-5 h-5" />
                  {item.label}
                  {item.path === '/rider/available-orders' && availableCount > 0 && (
                    <span className="ml-auto min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs font-bold flex items-center justify-center">
                      {availableCount > 99 ? '99+' : availableCount}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Logout */}
      <div className="p-4 border-t border-border mt-0">
        <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={handleLogout}>
          <LogOut className="w-5 h-5 mr-3" />
          Logout
        </Button>
      </div>
    </aside>
  );
}
