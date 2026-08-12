import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';
import { toast } from 'sonner';

type SupportTicket = Tables<'support_tickets'>;
type SupportMessage = Tables<'support_messages'>;

type SupportCategory = 'refund' | 'withdrawal' | 'order_issue' | 'account_issue' | 'payment' | 'delivery' | 'general';
type SupportUserType = 'customer' | 'vendor' | 'rider' | 'logistics';

export function useSupportChat(userId: string | undefined, userType: SupportUserType) {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sendingMessage, setSendingMessage] = useState(false);

  // Fetch tickets
  const fetchTickets = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });

      if (error) throw error;
      setTickets(data || []);
    } catch (error) {
      console.error('Error fetching tickets:', error);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  // Fetch messages for active ticket
  const fetchMessages = useCallback(async () => {
    if (!activeTicket) return;
    try {
      const { data, error } = await supabase
        .from('support_messages')
        .select('*')
        .eq('ticket_id', activeTicket.id)
        .order('created_at', { ascending: true });

      if (error) throw error;
      setMessages(data || []);

      // Mark unread messages as read
      const unreadIds = (data || [])
        .filter(m => !m.is_read && m.sender_type === 'admin')
        .map(m => m.id);

      if (unreadIds.length > 0) {
        await supabase
          .from('support_messages')
          .update({ is_read: true })
          .in('id', unreadIds);
      }
    } catch (error) {
      console.error('Error fetching messages:', error);
    }
  }, [activeTicket]);

  useEffect(() => {
    fetchTickets();
  }, [fetchTickets]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Polling safety net so messages show live even if the websocket drops
  useEffect(() => {
    if (!activeTicket) return;
    const t = setInterval(fetchMessages, 4000);
    return () => clearInterval(t);
  }, [activeTicket, fetchMessages]);


  // Subscribe to realtime updates for messages on the active ticket
  useEffect(() => {
    if (!activeTicket) return;

    const channel = supabase
      .channel(`support-messages-${activeTicket.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'support_messages',
          filter: `ticket_id=eq.${activeTicket.id}`,
        },
        (payload) => {
          const newMessage = payload.new as SupportMessage;
          setMessages(prev => {
            if (prev.some(m => m.id === newMessage.id)) return prev;
            return [...prev, newMessage];
          });

          if (newMessage.sender_type === 'admin') {
            supabase
              .from('support_messages')
              .update({ is_read: true })
              .eq('id', newMessage.id)
              .then();
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTicket]);

  // Global notification: toast on new admin replies for any of the user's tickets
  useEffect(() => {
    if (!userId || tickets.length === 0) return;
    const ticketIds = new Set(tickets.map(t => t.id));

    const channel = supabase
      .channel(`support-notify-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'support_messages' },
        (payload) => {
          const msg = payload.new as SupportMessage;
          if (!ticketIds.has(msg.ticket_id)) return;
          if (msg.sender_type !== 'admin') return;
          if (activeTicket?.id === msg.ticket_id) return;
          const ticket = tickets.find(t => t.id === msg.ticket_id);
          toast.message('💬 New support reply', {
            description: ticket?.subject
              ? `${ticket.subject}: ${msg.message.slice(0, 80)}`
              : msg.message.slice(0, 100),
          });
          fetchTickets();
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [userId, tickets, activeTicket, fetchTickets]);

  // Subscribe to ticket updates
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`support-tickets-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'support_tickets',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          fetchTickets();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchTickets]);

  const createTicket = async (category: SupportCategory, subject: string, initialMessage: string) => {
    if (!userId) return null;

    try {
      const { data: ticket, error: ticketError } = await supabase
        .from('support_tickets')
        .insert({
          user_id: userId,
          user_type: userType,
          category,
          subject,
        })
        .select()
        .single();

      if (ticketError) throw ticketError;

      // Send initial message
      const { error: msgError } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: ticket.id,
          sender_id: userId,
          sender_type: 'user',
          message: initialMessage,
        });

      if (msgError) throw msgError;

      await fetchTickets();
      setActiveTicket(ticket);
      return ticket;
    } catch (error) {
      console.error('Error creating ticket:', error);
      return null;
    }
  };

  const sendMessage = async (message: string) => {
    if (!activeTicket || !userId || !message.trim()) return;

    setSendingMessage(true);
    try {
      const { data: inserted, error } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: activeTicket.id,
          sender_id: userId,
          sender_type: 'user',
          message: message.trim(),
        })
        .select('*')
        .single();

      if (error) throw error;
      if (inserted) {
        setMessages(prev => (prev.some(m => m.id === inserted.id) ? prev : [...prev, inserted]));
      }
    } catch (error) {
      console.error('Error sending message:', error);
    } finally {
      setSendingMessage(false);
    }
  };

  const getUnreadCount = useCallback(() => {
    // This would need a separate query for efficiency; for now placeholder
    return 0;
  }, []);

  return {
    tickets,
    activeTicket,
    setActiveTicket,
    messages,
    loading,
    sendingMessage,
    createTicket,
    sendMessage,
    fetchTickets,
    getUnreadCount,
  };
}
