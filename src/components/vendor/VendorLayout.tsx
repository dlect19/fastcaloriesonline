import { ReactNode, useCallback, useState, useEffect, useRef } from 'react';
import { VendorSidebar } from '@/components/vendor/VendorSidebar';
import { VendorBottomNav } from '@/components/vendor/VendorBottomNav';
import { VendorMobileHeader } from '@/components/vendor/VendorMobileHeader';
import { AddOutletDialog } from '@/components/vendor/AddOutletDialog';
import { OutletProvider, useOutletContext } from '@/hooks/useOutletContext';
import { VendorPermission } from '@/hooks/useVendorPermissions';
import { useIsMobile } from '@/hooks/use-mobile';
import { useRepeatingNotificationSound } from '@/hooks/useRepeatingNotificationSound';
import { SoundEnableBanner } from '@/components/shared/SoundEnableBanner';
import { useCapacitorPush } from '@/hooks/useCapacitorPush';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ApkUpdateBanner } from '@/components/shared/ApkUpdateBanner';

interface VendorLayoutProps {
  children: ReactNode;
  vendorName?: string;
  vendorId?: string;
  permissions?: VendorPermission[];
  onOutletChange?: (outletId: string | null) => void;
}

function VendorLayoutContent({ children, vendorName, vendorId, permissions, onOutletChange }: VendorLayoutProps) {
  const { setSelectedOutletId, selectedOutlet } = useOutletContext();
  const isMobile = useIsMobile();
  const [addOutletOpen, setAddOutletOpen] = useState(false);
  const [newOrderCount, setNewOrderCount] = useState(0);
  const [resolvedVendorId, setResolvedVendorId] = useState<string | null>(vendorId || null);
  const { playOnce, startRepeating, stopRepeating, isPlaying, soundEnabled, isBlocked, setSoundEnabled, unlock } = useRepeatingNotificationSound({
    intervalMs: 8000,
    storageKey: 'vendor-notification-sound',
  });
  useCapacitorPush();

  const handleOutletChange = useCallback((outletId: string | null) => {
    if (outletId) setSelectedOutletId(outletId);
    onOutletChange?.(outletId);
  }, [onOutletChange, setSelectedOutletId]);

  // Resolve vendor ID
  useEffect(() => {
    if (vendorId) { setResolvedVendorId(vendorId); return; }
    const resolve = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: vendor } = await supabase.from('vendors').select('id').eq('user_id', user.id).maybeSingle();
      if (vendor) { setResolvedVendorId(vendor.id); return; }
      const { data: staff } = await supabase.from('vendor_staff').select('vendor_id').eq('user_id', user.id).eq('is_active', true).maybeSingle();
      if (staff) setResolvedVendorId(staff.vendor_id);
    };
    resolve();
  }, [vendorId]);

  // Track previous order count to detect new orders
  const prevOrderCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (!resolvedVendorId || !selectedOutlet?.id) { setNewOrderCount(0); return; }
    const outletId = selectedOutlet.id;
    const fetchCount = async () => {
      const { count } = await supabase.from('orders').select('*', { count: 'exact', head: true })
        .eq('vendor_id', resolvedVendorId).eq('outlet_id', outletId).in('status', ['pending', 'confirmed']);
      if (count !== null) {
        setNewOrderCount(prev => {
          // Start repeating sound when new order arrives
          if (prevOrderCountRef.current !== null && count > prevOrderCountRef.current) {
            startRepeating();
            toast.success('🔔 New Order!', {
              description: 'A new paid order has come in. Check your orders page.',
              duration: 8000,
            });
          }
          // Stop sound when orders are handled (count decreases or reaches 0)
          if (prevOrderCountRef.current !== null && count < prevOrderCountRef.current) {
            stopRepeating();
          }
          if (count === 0 && isPlaying) {
            stopRepeating();
          }
          prevOrderCountRef.current = count;
          return count;
        });
      }
    };
    fetchCount();
    const channel = supabase.channel('vendor-layout-orders').on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `vendor_id=eq.${resolvedVendorId}` }, () => fetchCount()).subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [resolvedVendorId, selectedOutlet?.id, startRepeating, stopRepeating, isPlaying]);

  return (
    <div className="min-h-screen bg-background">
      {/* Desktop: full sidebar */}
      {!isMobile && (
        <VendorSidebar
          vendorName={vendorName}
          vendorId={vendorId}
          permissions={permissions}
          onOutletChange={handleOutletChange}
        />
      )}

      {/* Mobile: compact header + bottom nav */}
      {isMobile && (
        <>
          <VendorMobileHeader
            vendorName={vendorName}
            vendorId={resolvedVendorId}
            onOutletChange={handleOutletChange}
            onAddOutlet={() => setAddOutletOpen(true)}
          />
          <VendorBottomNav orderCount={newOrderCount} />
        </>
      )}

      <main className={isMobile ? 'pt-24 pb-20 px-2' : 'lg:ml-64 pt-0'}>
        <ApkUpdateBanner appType="vendor" />
        <SoundEnableBanner
          soundEnabled={soundEnabled}
          isBlocked={isBlocked}
          onToggleSound={setSoundEnabled}
          onUnlock={unlock}
          onTestSound={playOnce}
        />
        {children}
      </main>

      {resolvedVendorId && (
        <AddOutletDialog open={addOutletOpen} onOpenChange={setAddOutletOpen} vendorId={resolvedVendorId} />
      )}
    </div>
  );
}

export function VendorLayout({ children, vendorName, vendorId, permissions, onOutletChange }: VendorLayoutProps) {
  return (
    <OutletProvider vendorId={vendorId || null} onOutletChange={onOutletChange}>
      <VendorLayoutContent vendorName={vendorName} vendorId={vendorId} permissions={permissions} onOutletChange={onOutletChange}>
        {children}
      </VendorLayoutContent>
    </OutletProvider>
  );
}
