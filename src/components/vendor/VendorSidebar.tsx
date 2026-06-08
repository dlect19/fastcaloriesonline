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
  Settings2,
  ExternalLink,
  Megaphone,
  Receipt,
  Pill,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useState, useEffect } from 'react';
import { VendorPermission } from '@/hooks/useVendorPermissions';
import { useAutoStoreStatus } from '@/hooks/useAutoStoreStatus';
import { OutletProvider } from '@/hooks/useOutletContext';
import { OutletSwitcher } from '@/components/vendor/OutletSwitcher';
import { AddOutletDialog } from '@/components/vendor/AddOutletDialog';
import { usePersistedOutletId } from '@/hooks/usePersistedOutletId';


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
  { id: 'pos', icon: Receipt, label: 'POS', path: '/vendor/pos', permission: 'use_pos' },
  { id: 'promos', icon: Ticket, label: 'Promos', path: '/vendor/promos', permission: 'manage_promos' },
  { id: 'voucher-verify', icon: Ticket, label: 'Event Vouchers', path: '/vendor/voucher-verify' },
  { id: 'riders', icon: Users, label: 'My Riders', path: '/vendor/riders', permission: 'manage_riders' },
  { id: 'staff', icon: Users, label: 'Staff', path: '/vendor/staff', permission: 'manage_staff' },
  { id: 'reviews', icon: Star, label: 'Reviews', path: '/vendor/reviews', permission: 'view_dashboard' },
  { id: 'earnings', icon: Wallet, label: 'Earnings', path: '/vendor/earnings', permission: 'view_earnings' },
  { id: 'withdraw', icon: ArrowUpRight, label: 'Withdraw', path: '/vendor/withdraw', permission: 'request_withdrawal' },
  { id: 'advertising', icon: Megaphone, label: 'Advertising', path: '/vendor/advertising', permission: 'view_dashboard' },
  { id: 'hours', icon: Clock, label: 'Working Hours', path: '/vendor/hours', permission: 'edit_settings' },
  { id: 'store-settings', icon: Settings2, label: 'Store Settings', path: '/vendor/store-settings', permission: 'edit_settings' },
  { id: 'support', icon: MessageSquare, label: 'Support', path: '/vendor/support' },
  { id: 'settings', icon: Settings, label: 'Main Settings', path: '/vendor/settings', permission: 'edit_settings' },
];

interface VendorSidebarProps {
  vendorName?: string;
  permissions?: VendorPermission[];
  vendorId?: string;
  selectedOutletId?: string | null;
  onOutletChange?: (outletId: string | null) => void;
}

export function VendorSidebar({ vendorName = 'My Restaurant', permissions = [], vendorId, selectedOutletId: selectedOutletIdProp, onOutletChange }: VendorSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [newOrderCount, setNewOrderCount] = useState(0);
  const [resolvedVendorId, setResolvedVendorId] = useState<string | null>(vendorId || null);
  const [vendorCategory, setVendorCategory] = useState<string | null>(null);
  const [addOutletOpen, setAddOutletOpen] = useState(false);
  
  // Use persisted outlet as fallback when the prop isn't provided
  const { selectedOutletId: persistedOutletId } = usePersistedOutletId();
  const effectiveOutletId = selectedOutletIdProp ?? persistedOutletId;

  // Resolve vendor ID from auth user if not provided
  useEffect(() => {
    if (vendorId) {
      setResolvedVendorId(vendorId);
      return;
    }
    const resolve = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      // Check if owner
      const { data: vendor } = await supabase
        .from('vendors')
        .select('id, category')
        .eq('user_id', user.id)
        .maybeSingle();
      if (vendor) {
        setResolvedVendorId(vendor.id);
        setVendorCategory(vendor.category);
        return;
      }
      // Check if staff
      const { data: staff } = await supabase
        .from('vendor_staff')
        .select('vendor_id, vendors(category)')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();
      if (staff) {
        setResolvedVendorId(staff.vendor_id);
        setVendorCategory((staff as any).vendors?.category ?? null);
      }
    };
    resolve();
  }, [vendorId]);

  // If vendorId was passed as prop, fetch its category separately
  useEffect(() => {
    if (!vendorId) return;
    supabase.from('vendors').select('category').eq('id', vendorId).maybeSingle()
      .then(({ data }) => setVendorCategory(data?.category ?? null));
  }, [vendorId]);

  // Fetch pending/confirmed order count and subscribe to realtime updates
  // Scoped to selected outlet so badge only reflects the active branch
  useEffect(() => {
    if (!resolvedVendorId || !effectiveOutletId) {
      setNewOrderCount(0);
      return;
    }

    const fetchCount = async () => {
      const { count, error } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('vendor_id', resolvedVendorId)
        .eq('outlet_id', effectiveOutletId)
        .in('status', ['pending', 'confirmed']);

      if (!error && count !== null) {
        setNewOrderCount(count);
      }
    };

    fetchCount();

    const channel = supabase
      .channel('vendor-sidebar-orders')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `vendor_id=eq.${resolvedVendorId}`,
        },
        (payload) => {
          // Only refresh count if the changed order belongs to the selected outlet
          const orderOutletId = (payload.new as any)?.outlet_id || (payload.old as any)?.outlet_id;
          if (orderOutletId === effectiveOutletId) {
            fetchCount();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [resolvedVendorId, effectiveOutletId]);

  // Auto-close/open store based on working hours (runs on every vendor page)
  useAutoStoreStatus(resolvedVendorId);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/vendor/auth');
  };

  // Filter nav items based on user permissions
  // If no permissions are passed (owner/loading), show all items
  const baseItems = permissions.length > 0 
    ? navItems.filter(item => !item.permission || permissions.includes(item.permission))
    : navItems;

  // Pharmacy vendors see "Drugs" instead of "Menu" with a Pill icon
  const visibleItemsBase = baseItems.map(item =>
    item.id === 'menu' && vendorCategory === 'pharmacy'
      ? { ...item, label: 'Drugs', icon: Pill }
      : item
  );

  // Add pharmacist review entry for pharmacy vendors (right after Orders)
  const visibleItems = vendorCategory === 'pharmacy'
    ? (() => {
        const idx = visibleItemsBase.findIndex((x) => x.id === 'orders');
        const out = [...visibleItemsBase];
        out.splice(idx + 1, 0, {
          id: 'pharmacy-review',
          icon: Pill,
          label: 'Rx Review',
          path: '/vendor/pharmacy-review',
          permission: 'process_orders' as VendorPermission,
        });
        return out;
      })()
    : visibleItemsBase;

  return (
    <>
      {/* Mobile Header - hidden since VendorLayout handles mobile via VendorMobileHeader */}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-screen flex flex-col bg-card border-r border-border transition-all duration-300 hidden lg:flex',
          collapsed ? 'w-16' : 'w-64',
        )}
      >
        {/* Logo (fixed) */}
        <div className="h-16 flex-shrink-0 flex items-center justify-between px-4 border-b border-border">
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

        {/* Outlet Switcher (fixed) */}
        <OutletProvider vendorId={resolvedVendorId} onOutletChange={onOutletChange}>
          <div className="flex-shrink-0 px-3 pt-3 pb-1">
            <OutletSwitcher
              collapsed={collapsed}
              onAddOutlet={() => setAddOutletOpen(true)}
            />
          </div>
        </OutletProvider>

        {/* Navigation (independently scrollable) */}
        <nav className="flex-1 min-h-0 overflow-y-auto p-3 space-y-1">
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
                {!collapsed && <span className="text-sm font-medium flex-1">{item.label}</span>}
                {item.id === 'orders' && newOrderCount > 0 && (
                  <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-destructive text-destructive-foreground text-xs font-bold flex items-center justify-center">
                    {newOrderCount > 99 ? '99+' : newOrderCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Switch to Customer App (fixed) */}
        <div className="flex-shrink-0 px-3 pb-1">
          <button
            onClick={() => {
              localStorage.removeItem('fc_last_portal');
              navigate('/?portal=customer');
            }}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors",
              collapsed && "justify-center px-0"
            )}
          >
            <ExternalLink className="w-4 h-4 flex-shrink-0" />
            {!collapsed && <span className="text-xs font-medium">Customer App</span>}
          </button>
        </div>

        {/* Logout (fixed) */}
        <div className="flex-shrink-0 p-3 border-t border-border">
          <button
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="text-sm font-medium">Sign Out</span>}
          </button>
        </div>
      </aside>

      {/* Mobile overlay removed - sidebar is desktop only now */}

      {/* Add Outlet Dialog */}
      {resolvedVendorId && (
        <AddOutletDialog
          open={addOutletOpen}
          onOpenChange={setAddOutletOpen}
          vendorId={resolvedVendorId}
        />
      )}
    </>
  );
}
