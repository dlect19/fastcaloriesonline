import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface EventRow {
  id: string;
  name: string;
  slug: string | null;
  banner_url: string | null;
  description: string | null;
  location_text: string | null;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  organizer: string | null;
  capacity: number | null;
  terms: string | null;
  status: 'draft' | 'published' | 'paused' | 'cancelled' | 'completed';
  created_at: string;
}

export interface TicketTypeRow {
  id: string;
  event_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  price: number;
  qty_available: number;
  qty_sold: number;
  max_per_customer: number;
  sales_start: string | null;
  sales_end: string | null;
  sort_order: number;
  is_active: boolean;
}

export function usePublishedEvents() {
  const [events, setEvents] = useState<(EventRow & { starting_price: number | null })[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('events')
        .select('*, event_ticket_types(price)')
        .eq('status', 'published')
        .gte('event_date', new Date().toISOString().slice(0, 10))
        .order('event_date', { ascending: true });

      const mapped = (data || []).map((e: any) => {
        const prices = (e.event_ticket_types || []).map((t: any) => Number(t.price));
        return {
          ...e,
          starting_price: prices.length ? Math.min(...prices) : null,
        } as EventRow & { starting_price: number | null };
      });
      setEvents(mapped);
      setLoading(false);
    })();
  }, []);

  return { events, loading };
}

export function useEvent(eventId: string | undefined) {
  const [event, setEvent] = useState<EventRow | null>(null);
  const [ticketTypes, setTicketTypes] = useState<TicketTypeRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!eventId) return;
    setLoading(true);
    const [{ data: e }, { data: tt }] = await Promise.all([
      supabase.from('events').select('*').eq('id', eventId).maybeSingle(),
      supabase.from('event_ticket_types').select('*').eq('event_id', eventId).order('sort_order', { ascending: true }),
    ]);
    setEvent(e as any);
    setTicketTypes((tt || []) as any);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { refetch(); }, [refetch]);

  return { event, ticketTypes, loading, refetch };
}

export function useMyTickets() {
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const { data } = await supabase
        .from('event_tickets')
        .select('*, events(*), event_ticket_types(name, image_url)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      setTickets(data || []);
      setLoading(false);
    })();
  }, []);

  return { tickets, loading };
}
