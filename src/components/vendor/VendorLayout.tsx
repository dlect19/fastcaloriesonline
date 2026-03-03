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
import { IncomingOrderCall } from '@/components/vendor/IncomingOrderCall';
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
  const [callData, setCallData] = useState<{ orderNumber?: string; orderTotal?: string; orderId?: string } | null>(null);
  const { playOnce, startRepeating, stopRepeating, isPlaying, soundEnabled, isBlocked, setSoundEnabled, unlock } = useRepeatingNotificationSound({
    intervalMs: 8000,
    storageKey: 'vendor-notification-sound',
  });
  useCapacitorPush();

  // Listen for CALL-type push notifications (Capacitor native + PWA service worker)
  useEffect(() => {
    let nativeCleanup: (() => void) | undefined;

    // Native Capacitor listener
    const setupNative = async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const listener = await PushNotifications.addListener('pushNotificationReceived', (notification) => {
          const data = notification.data;
          if (data?.type === 'CALL') {
            setCallData({
              orderNumber: data.order_number,
              orderTotal: data.order_total,
              orderId: data.order_id,
            });
            startRepeating();
          }
        });
        nativeCleanup = () => listener.remove();
      } catch {
        // Not in Capacitor environment
      }
    };
    setupNative();

    // PWA service worker message listener
    const handleSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'INCOMING_ORDER_CALL') {
        const d = event.data.data;
        setCallData({
          orderNumber: d?.order_number,
          orderTotal: d?.order_total,
          orderId: d?.order_id,
        });
        startRepeating();
      }
    };
    navigator.serviceWorker?.addEventListener('message', handleSwMessage);

    return () => {
      nativeCleanup?.();
      navigator.serviceWorker?.removeEventListener('message', handleSwMessage);
    };
  }, [startRepeating]);

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
      <IncomingOrderCall
        visible={!!callData}
        orderNumber={callData?.orderNumber}
        orderTotal={callData?.orderTotal}
        orderId={callData?.orderId}
        onAccept={() => { setCallData(null); stopRepeating(); }}
        onDismiss={() => { setCallData(null); stopRepeating(); }}
      />
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
