import { useState, useEffect, useRef, useCallback } from 'react';
import { Bell } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import { playGlobalNotificationSound } from '@/lib/globalAudio';

export function AdminNotificationBell() {
  const [newOrderCount, setNewOrderCount] = useState(0);
  const lastCountRef = useRef(0);
  const soundIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const navigate = useNavigate();

  // Repeating sound alert when there are pending orders
  useEffect(() => {
    if (newOrderCount > 0) {
      // Play immediately
      playGlobalNotificationSound();
      // Repeat every 15 seconds until acknowledged
      soundIntervalRef.current = setInterval(() => {
        playGlobalNotificationSound();
      }, 15000);
    } else {
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
    lastCountRef.current = newCount;
    setNewOrderCount(newCount);
  }, []);

  useEffect(() => {
    fetchPendingOrders();

    const channel = supabase
      .channel('admin-new-orders-bell')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, () => {
        fetchPendingOrders();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, () => {
        fetchPendingOrders();
      })
      .subscribe();

    // Poll every 30s as backup
    const interval = setInterval(fetchPendingOrders, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [fetchPendingOrders]);

  return (
    <button
      onClick={() => {
        setNewOrderCount(0);
        lastCountRef.current = 0;
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
