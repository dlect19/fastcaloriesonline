import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { playGlobalNotificationSound } from '@/lib/globalAudio';

const ORIGINAL_TITLE = typeof document !== 'undefined' ? document.title : '';

function flashTitle(count: number) {
  if (typeof document === 'undefined') return;
  if (count > 0) {
    document.title = `🔔 (${count}) New Order${count > 1 ? 's' : ''} — Admin`;
  } else {
    document.title = ORIGINAL_TITLE || 'Admin Portal';
  }
}

function showBrowserNotification(count: number) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  try {
    const n = new Notification('🔔 New Order Received', {
      body: `${count} pending order${count > 1 ? 's' : ''} awaiting action.`,
      icon: '/favicon.ico',
      tag: 'admin-new-order',
      requireInteraction: true,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    // ignore
  }
}

export function AdminNotificationBell() {
  const [newOrderCount, setNewOrderCount] = useState(0);
  const lastCountRef = useRef(0);
  const soundIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();

  // Request browser notification permission once on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Repeating sound alert when there are pending orders.
  // Note: setInterval is throttled in background tabs (min ~1s), but audio
  // playback itself continues normally. We use a longer 10s interval and
  // ALSO trigger an immediate play on Realtime INSERTs (handled below).
  useEffect(() => {
    if (newOrderCount > 0) {
      playGlobalNotificationSound();
      flashTitle(newOrderCount);
      soundIntervalRef.current = setInterval(() => {
        playGlobalNotificationSound();
      }, 10000);
    } else {
      flashTitle(0);
      if (soundIntervalRef.current) {
        clearInterval(soundIntervalRef.current);
        soundIntervalRef.current = null;
      }
    }
    return () => {
      if (soundIntervalRef.current) {
        clearInterval(soundIntervalRef.current);
        soundIntervalRef.current = null;
      }
    };
  }, [newOrderCount]);

  const fetchPendingOrders = useCallback(async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { count } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .gte('created_at', fiveMinutesAgo);

    const newCount = count || 0;
    const prev = lastCountRef.current;
    lastCountRef.current = newCount;
    setNewOrderCount(newCount);

    // If new order(s) arrived while tab was inactive, force an immediate
    // sound + browser notification (Realtime fires reliably in background).
    if (newCount > prev) {
      playGlobalNotificationSound();
      showBrowserNotification(newCount);
    }
  }, []);

  useEffect(() => {
    fetchPendingOrders();

    const channel = supabase
      .channel('admin-new-orders-bell')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        // Realtime continues working in background tabs — fire sound + system notification immediately
        playGlobalNotificationSound();
        // Fire a system notification so the OS alerts even if tab audio is throttled
        showBrowserNotification((lastCountRef.current || 0) + 1);
        fetchPendingOrders();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => {
        fetchPendingOrders();
      })
      .subscribe();

    // Poll every 30s as backup (still runs in background, just throttled)
    const interval = setInterval(fetchPendingOrders, 30000);

    // When tab becomes visible again, refresh count immediately
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchPendingOrders();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [fetchPendingOrders]);

  return (
    <button
      onClick={() => {
        setNewOrderCount(0);
        lastCountRef.current = 0;
        flashTitle(0);
        navigate('/admin/orders');
      }}
      className="relative p-2 rounded-lg hover:bg-secondary transition-colors"
      aria-label="New orders"
    >
      <Bell className={`w-5 h-5 ${newOrderCount > 0 ? 'text-primary animate-bounce' : 'text-muted-foreground'}`} />
      {newOrderCount > 0 && (
        <Badge
          variant="destructive"
          className="absolute -top-1 -right-1 text-[10px] px-1.5 py-0 min-w-[18px] h-[18px] flex items-center justify-center"
        >
          {newOrderCount}
        </Badge>
      )}
    </button>
  );
}
