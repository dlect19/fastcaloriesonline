import { useLocation, useNavigate } from 'react-router-dom';
import { Home, Package, Users, Wallet, ArrowUpRight, Settings, LogOut, Truck, Menu, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

interface DeliverySidebarProps {
  companyName?: string;
}

const menuItems = [
  { icon: Home, label: 'Dashboard', path: '/delivery/dashboard' },
  { icon: Package, label: 'Deliveries', path: '/delivery/orders' },
  { icon: Users, label: 'My Riders', path: '/delivery/riders' },
  { icon: Wallet, label: 'Earnings', path: '/delivery/earnings' },
  { icon: ArrowUpRight, label: 'Withdraw', path: '/delivery/withdraw' },
  { icon: Settings, label: 'Settings', path: '/delivery/settings' },
];

export function DeliverySidebar({ companyName }: DeliverySidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    toast({ title: 'Logged out successfully' });
    navigate('/delivery/auth');
  };

  const SidebarContent = () => (
    <>
      {/* Logo Header */}
      <div className="p-6 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img src={fastCaloriesLogo} alt="Fast Calories" className="w-14 h-14 object-contain" />
            <div className="absolute -bottom-1 -right-1 bg-primary rounded-full p-0.5">
              <Truck className="w-3 h-3 text-primary-foreground" />
            </div>
          </div>
          <div>
            <h1 className="font-bold text-foreground text-sm">{companyName || 'Logistics Partner'}</h1>
            <p className="text-xs text-muted-foreground">Delivery Company</p>
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
                  onClick={() => {
                    navigate(item.path);
                    setMobileOpen(false);
                  }}
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
    </>
  );

  return (
    <>
      {/* Mobile Header */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-card border-b border-border px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="relative">
            <img src={fastCaloriesLogo} alt="Fast Calories" className="w-10 h-10 object-contain" />
            <div className="absolute -bottom-0.5 -right-0.5 bg-primary rounded-full p-0.5">
              <Truck className="w-2 h-2 text-primary-foreground" />
            </div>
          </div>
          <span className="font-semibold text-sm">{companyName || 'Logistics Portal'}</span>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setMobileOpen(!mobileOpen)}>
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </Button>
      </div>

      {/* Mobile Sidebar Overlay */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMobileOpen(false)} />
      )}

      {/* Mobile Sidebar */}
      <aside className={cn(
        "lg:hidden fixed top-14 left-0 bottom-0 z-40 w-64 bg-card border-r border-border flex flex-col transition-transform",
        mobileOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <SidebarContent />
      </aside>

      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex w-64 min-h-screen bg-card border-r border-border flex-col fixed left-0 top-0">
        <SidebarContent />
      </aside>
    </>
  );
}
