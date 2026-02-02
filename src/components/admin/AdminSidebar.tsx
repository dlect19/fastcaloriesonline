import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Package, Store, Bike, Ticket, Users, Settings, LogOut, Image, Activity, Banknote, Wallet, ArrowDownLeft, Gift, Truck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

const menuItems = [
  { icon: Home, label: 'Dashboard', path: '/admin/dashboard' },
  { icon: Package, label: 'Orders', path: '/admin/orders' },
  { icon: Store, label: 'Vendors', path: '/admin/vendors' },
  { icon: Bike, label: 'Riders', path: '/admin/riders' },
  { icon: Truck, label: 'Delivery Companies', path: '/admin/delivery-companies' },
  { icon: Banknote, label: 'Payouts', path: '/admin/payouts' },
  { icon: Wallet, label: 'Customer Wallets', path: '/admin/customer-wallets' },
  { icon: ArrowDownLeft, label: 'Wallet Funding', path: '/admin/wallet-funding' },
  { icon: Activity, label: 'Nutrition', path: '/admin/nutrition' },
  { icon: Ticket, label: 'Promo Codes', path: '/admin/promos' },
  { icon: Gift, label: 'Rewards & Spins', path: '/admin/rewards' },
  { icon: Image, label: 'Carousel', path: '/admin/advertisements' },
  { icon: Users, label: 'Users', path: '/admin/users' },
  { icon: Users, label: 'Admin Staff', path: '/admin/staff' },
  { icon: Settings, label: 'Settings', path: '/admin/settings' },
];

export function AdminSidebar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();

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
