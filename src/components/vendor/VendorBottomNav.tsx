import { useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  UtensilsCrossed,
  ShoppingBag,
  MessageSquare,
  Wallet,
  Pill,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { usePosNavLock, POS_LOCK_HINT } from '@/hooks/usePosNavLock';

const navItems = [
  { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard', path: '/vendor/dashboard' },
  { id: 'menu', icon: UtensilsCrossed, label: 'Menu', path: '/vendor/menu' },
  { id: 'orders', icon: ShoppingBag, label: 'Orders', path: '/vendor/orders' },
  { id: 'support', icon: MessageSquare, label: 'Support', path: '/vendor/support' },
  { id: 'earnings', icon: Wallet, label: 'Earnings', path: '/vendor/earnings' },
];

interface VendorBottomNavProps {
  orderCount?: number;
}

export function VendorBottomNav({ orderCount = 0 }: VendorBottomNavProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [vendorCategory, setVendorCategory] = useState<string | null>(null);

  useEffect(() => {
    const fetchCategory = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: vendor } = await supabase
        .from('vendors')
        .select('category')
        .eq('user_id', user.id)
        .maybeSingle();
      if (vendor) {
        setVendorCategory(vendor.category);
        return;
      }
      const { data: staff } = await supabase
        .from('vendor_staff')
        .select('vendors(category)')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      setVendorCategory((staff as any)?.vendors?.category ?? null);
    };
    fetchCategory();
  }, []);

  const items = navItems.map(item =>
    item.id === 'menu' && vendorCategory === 'pharmacy'
      ? { ...item, label: 'Drugs', icon: Pill }
      : item
  );

  const currentTab = items.find(item => location.pathname.startsWith(item.path))?.id || 'dashboard';

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t border-border safe-bottom z-50 lg:hidden">
      <div className="flex items-center justify-around py-2">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = currentTab === item.id;

          const isLocked = navLocked && item.path !== '/vendor/pos';

          return (
            <button
              key={item.id}
              disabled={isLocked}
              title={isLocked ? POS_LOCK_HINT : undefined}
              onClick={() => { if (!isLocked) navigate(item.path); }}
              className={cn(
                'relative flex flex-col items-center gap-0.5 py-1.5 px-3 rounded-xl transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground',
                isLocked && 'opacity-40 cursor-not-allowed pointer-events-none'
              )}
            >
              <Icon
                className={cn('w-5 h-5 transition-all', isActive && 'scale-110')}
                fill={isActive ? 'currentColor' : 'none'}
              />
              <span className="text-[10px] font-medium">{item.label}</span>
              {item.id === 'orders' && orderCount > 0 && (
                <span className="absolute -top-0.5 right-1 min-w-[16px] h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
                  {orderCount > 99 ? '99+' : orderCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
