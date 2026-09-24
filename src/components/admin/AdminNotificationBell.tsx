import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { playGlobalNotificationSound } from '@/lib/globalAudio';
import { useFreshActionable } from '@/hooks/useFreshActionable';

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

function isActionableAdminOrder(o: any) {
  if (!o || o.channel === 'pos') return false;
  if (!['pending', 'confirmed'].includes(o.status)) return false;
  return o.payment_status === 'paid' || o.payment_method === 'cash';
}

export function AdminNotificationBell() {
  const [actionableIds, setActionableIds] = useState<string[] | null>(null);
  const soundIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();
  const { freshCount, acknowledge } = useFreshActionable('admin-bell', 'admin', actionableIds);
  const newOrderCount = freshCount;

  // Request browser notification permission once on mount
  useEffect(() => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  // Sound only for orders that became actionable after this device was
  // already listening. Existing orders on open form a silent baseline.
  const prevFreshRef = useRef(0);
  useEffect(() => {
    if (freshCount > prevFreshRef.current) {
      playGlobalNotificationSound();
      showBrowserNotification(freshCount);
    }
    prevFreshRef.current = freshCount;
    if (freshCount > 0) {
      flashTitle(freshCount);
      if (!soundIntervalRef.current) {
        soundIntervalRef.current = setInterval(() => {
          playGlobalNotificationSound();
        }, 10000);
      }
    } else {
      flashTitle(0);
      if (soundIntervalRef.current) {
        clearInterval(soundIntervalRef.current);
        soundIntervalRef.current = null;
      }
    }
  }, [freshCount]);

  useEffect(() => () => {
    if (soundIntervalRef.current) clearInterval(soundIntervalRef.current);
  }, []);

  const fetchPendingOrders = useCallback(async () => {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { data, error } = await supabase
      .from('orders')
      .select('id, status, channel, payment_status, payment_method')
      .in('status', ['pending', 'confirmed'])
      .gte('created_at', since)
      .limit(200);
    if (error) return;
    setActionableIds((data || []).filter(isActionableAdminOrder).map((o: any) => o.id));
  }, []);

  useEffect(() => {
    fetchPendingOrders();

    const channel = supabase
      .channel('admin-new-orders-bell')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
        const row: any = payload.new;
        if (row?.channel === 'pos') return;
        fetchPendingOrders();
      })
      .subscribe();

    const interval = setInterval(fetchPendingOrders, 30000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') fetchPendingOrders();
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
        acknowledge();
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
