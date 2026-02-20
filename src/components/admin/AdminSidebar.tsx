import { useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Home, Package, Store, Bike, Ticket, Users, Settings, LogOut, Image, Activity, Banknote, Wallet, ArrowDownLeft, Gift, Truck, UserCheck, Star, MessageSquare, DollarSign, UserPlus, Receipt, ClipboardList, Scale, HelpCircle, Percent } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';
import { useAdminPermissions, type AdminPermission } from '@/hooks/useAdminPermissions';

interface MenuItem {
  icon: any;
  label: string;
  path: string;
  badgeKey?: 'payouts';
  requiredPermission?: AdminPermission;
}

const menuItems: MenuItem[] = [
  { icon: Home, label: 'Dashboard', path: '/admin/dashboard', requiredPermission: 'view_dashboard' },
  { icon: Package, label: 'Orders', path: '/admin/orders', requiredPermission: 'manage_vendors' },
  { icon: Store, label: 'Vendors', path: '/admin/vendors', requiredPermission: 'manage_vendors' },
  { icon: Bike, label: 'Riders', path: '/admin/riders', requiredPermission: 'manage_riders' },
  { icon: Star, label: 'Reviews', path: '/admin/reviews', requiredPermission: 'manage_vendors' },
  { icon: Truck, label: 'Delivery Companies', path: '/admin/delivery-companies', requiredPermission: 'manage_vendors' },
  { icon: UserCheck, label: 'Customers', path: '/admin/customers', requiredPermission: 'manage_users' },
  { icon: Banknote, label: 'Payouts', path: '/admin/payouts', badgeKey: 'payouts', requiredPermission: 'process_withdrawals' },
  { icon: Wallet, label: 'Customer Wallets', path: '/admin/customer-wallets', requiredPermission: 'manage_users' },
  { icon: ArrowDownLeft, label: 'Wallet Funding', path: '/admin/wallet-funding', requiredPermission: 'manage_users' },
  { icon: Activity, label: 'Nutrition', path: '/admin/nutrition', requiredPermission: 'view_reports' },
  { icon: Ticket, label: 'Promo Codes', path: '/admin/promos', requiredPermission: 'manage_promos' },
  { icon: Percent, label: 'Commission Promos', path: '/admin/commission-promos', requiredPermission: 'manage_promos' },
  { icon: Gift, label: 'Rewards & Spins', path: '/admin/rewards', requiredPermission: 'manage_promos' },
  { icon: Image, label: 'Carousel', path: '/admin/advertisements', requiredPermission: 'manage_vendors' },
  { icon: Users, label: 'Users', path: '/admin/users', requiredPermission: 'manage_users' },
  { icon: Users, label: 'Admin Staff', path: '/admin/staff', requiredPermission: 'manage_admin_staff' },
  { icon: DollarSign, label: 'Payroll', path: '/admin/payroll', requiredPermission: 'manage_admin_staff' },
  { icon: UserPlus, label: 'Referrals', path: '/admin/referrals', requiredPermission: 'manage_promos' },
  { icon: ClipboardList, label: 'Requisitions', path: '/admin/requisitions' },
  { icon: Receipt, label: 'Expenses', path: '/admin/expenses', requiredPermission: 'process_withdrawals' },
  { icon: Scale, label: 'Legal', path: '/admin/legal', requiredPermission: 'platform_settings' },
  { icon: HelpCircle, label: 'FAQ', path: '/admin/faq', requiredPermission: 'platform_settings' },
  { icon: MessageSquare, label: 'Support', path: '/admin/support', requiredPermission: 'handle_support' },
  { icon: Settings, label: 'Settings', path: '/admin/settings', requiredPermission: 'platform_settings' },
];

export function AdminSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hasPermission, isSuperAdmin } = useAdminPermissions();
  const [pendingPayouts, setPendingPayouts] = useState(0);

  // Filter menu items based on permissions
  const visibleItems = menuItems.filter(item => {
    if (isSuperAdmin) return true;
    if (!item.requiredPermission) return true;
    return hasPermission(item.requiredPermission);
  });

  useEffect(() => {
    const fetchPendingPayouts = async () => {
      const { count } = await supabase
        .from('payout_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      setPendingPayouts(count || 0);
    };

    fetchPendingPayouts();

    const channel = supabase
      .channel('admin-payout-badge')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payout_requests' }, () => {
        fetchPendingPayouts();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast({ title: 'Logged out successfully' });
    navigate('/admin/auth');
  };

  return (
    <aside className="w-64 min-h-screen bg-card border-r border-border flex flex-col">
      {/* Logo Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <img src={fastCaloriesLogo} alt="Fast Calories" className="w-14 h-14 object-contain" />
          <div>
            <h1 className="font-bold text-foreground">Fast Calories</h1>
            <p className="text-xs text-muted-foreground">Admin Portal</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          {visibleItems.map((item) => {
            const isActive = location.pathname === item.path;
            const badgeCount = item.badgeKey === 'payouts' ? pendingPayouts : 0;
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
                  {badgeCount > 0 && (
                    <Badge variant="destructive" className="ml-auto text-xs px-1.5 py-0.5 min-w-[20px] text-center">
                      {badgeCount}
                    </Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Logout */}
      <div className="p-4 border-t border-border">
        <Button variant="ghost" className="w-full justify-start text-muted-foreground" onClick={handleLogout}>
          <LogOut className="w-5 h-5 mr-3" />
          Logout
        </Button>
      </div>
    </aside>
  );
}
