import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { playChatSound } from '@/lib/chatSound';

/**
 * Global subscription that alerts the customer when a new order-chat message
 * arrives on any of their orders. Plays a sound and shows a toast that links
 * to the order detail page. Suppressed while the user is already viewing
 * that order's page (the in-page OrderChat handles it there).
 */
export function useCustomerChatNotifications() {
  const { user } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location.pathname);
  locationRef.current = location.pathname;

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`customer-chat-notify-${user.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'order_chat_messages' },
        async (payload) => {
          const msg = payload.new as {
            id: string;
            order_id: string;
            sender_id: string | null;
            sender_role: string;
            message: string | null;
            message_type: string | null;
          };
          if (!msg?.order_id) return;
          if (msg.sender_id === user.id) return;
          if (msg.sender_role === 'customer') return;

          // Confirm this order belongs to the current user (RLS already restricts,
          // but double-check to ignore any cross-role messages).
          const { data: order } = await supabase
            .from('orders')
            .select('id, order_number, user_id')
            .eq('id', msg.order_id)
            .maybeSingle();
          if (!order || order.user_id !== user.id) return;

          // Suppress if already viewing this order
          if (locationRef.current.includes(`/orders/${order.id}`)) return;

          playChatSound();
          const who = msg.sender_role === 'rider' ? 'Rider' : msg.sender_role === 'vendor' ? 'Vendor' : 'Support';
          const preview =
            msg.message_type === 'image'
              ? '📷 Sent a photo'
              : msg.message_type === 'voice'
                ? '🎤 Sent a voice note'
                : (msg.message || 'New message');
          toast({
            title: `💬 New message from ${who}`,
            description: `Order #${order.order_number}: ${preview.slice(0, 80)} — tap Orders to reply`,
            duration: 6000,
          });
          void navigate;
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, navigate, toast]);
}
