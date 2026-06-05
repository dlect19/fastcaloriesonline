import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Calendar, MapPin, Users, Minus, Plus, Loader2 } from 'lucide-react';
import { useEvent } from '@/hooks/useEvents';
import { Button } from '@/components/ui/button';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

export default function EventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { event, ticketTypes, loading } = useEvent(id);
  const { user } = useAuth();
  const { toast } = useToast();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [submitting, setSubmitting] = useState(false);

  const items = Object.entries(qty).filter(([, q]) => q > 0);
  const total = items.reduce((s, [ttId, q]) => {
    const tt = ticketTypes.find(t => t.id === ttId);
    return s + (tt ? Number(tt.price) * q : 0);
  }, 0);

  const setQ = (ttId: string, delta: number, max: number) => {
    setQty(prev => {
      const next = Math.max(0, Math.min(max, (prev[ttId] || 0) + delta));
      return { ...prev, [ttId]: next };
    });
  };

  const handleBuy = async () => {
    if (!user) {
      navigate('/auth');
      return;
    }
    if (items.length === 0) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('purchase-event-tickets', {
        body: {
          event_id: id,
          items: items.map(([ticket_type_id, quantity]) => ({ ticket_type_id, quantity })),
        },
      });
      if (error || data?.error) {
        const msg = data?.error || error?.message || 'Purchase failed';
        if (msg === 'INSUFFICIENT_BALANCE') {
          toast({ title: 'Insufficient wallet balance', description: 'Please fund your wallet and try again.', variant: 'destructive' });
          navigate('/profile/wallet');
        } else {
          toast({ title: 'Could not purchase', description: msg, variant: 'destructive' });
        }
        return;
      }
      toast({ title: 'Tickets purchased!', description: `Order ${data.order_number}` });
      navigate('/my-events');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center"><Loader2 className="animate-spin" /></div>;
  }
  if (!event) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Event not found</div>;
  }

  return (
    <div className="min-h-screen bg-background pb-32">
      <header className="sticky top-0 z-20 bg-card/80 backdrop-blur border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 -ml-1.5 rounded hover:bg-secondary">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold line-clamp-1">{event.name}</h1>
      </header>

      <div
        className="h-56 bg-cover bg-center bg-muted"
        style={{ backgroundImage: event.banner_url ? `url(${event.banner_url})` : undefined }}
      />

      <div className="p-4 space-y-4">
        <div>
          <h2 className="text-xl font-bold text-foreground">{event.name}</h2>
          <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
            <Calendar className="w-4 h-4" />
            <span>{format(parseISO(event.event_date), 'EEE, MMM d, yyyy')}{event.start_time ? ` · ${event.start_time.slice(0, 5)}` : ''}</span>
          </div>
          {event.location_text && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
              <MapPin className="w-4 h-4" />
              <span>{event.location_text}</span>
            </div>
          )}
          {event.organizer && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground mt-1">
              <Users className="w-4 h-4" />
              <span>By {event.organizer}</span>
            </div>
          )}
        </div>

        {event.description && (
          <div>
            <h3 className="font-semibold mb-1">About</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{event.description}</p>
          </div>
        )}

        <div>
          <h3 className="font-semibold mb-2">Tickets</h3>
          <div className="space-y-2">
            {ticketTypes.filter(t => t.is_active).map(tt => {
              const remaining = tt.qty_available - tt.qty_sold;
              const soldOut = remaining <= 0;
              const lowStock = !soldOut && remaining <= Math.max(5, tt.qty_available * 0.1);
              const maxAllowed = Math.min(remaining, tt.max_per_customer);
              const current = qty[tt.id] || 0;
              return (
                <div key={tt.id} className="bg-card border border-border rounded-lg p-3 flex items-center gap-3">
                  {tt.image_url && (
                    <img src={tt.image_url} alt={tt.name} className="w-14 h-14 rounded object-cover" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-sm">{tt.name}</p>
                      {soldOut && <span className="text-[10px] px-1.5 py-0.5 rounded bg-destructive/10 text-destructive font-medium">Sold out</span>}
                      {lowStock && <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-600 font-medium">Low stock</span>}
                    </div>
                    {tt.description && <p className="text-xs text-muted-foreground line-clamp-2">{tt.description}</p>}
                    <p className="text-sm font-bold text-primary mt-0.5">₦{Number(tt.price).toLocaleString()}</p>
                  </div>
                  {!soldOut && (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setQ(tt.id, -1, maxAllowed)}
                        disabled={current === 0}
                        className="w-7 h-7 rounded-full border border-border flex items-center justify-center disabled:opacity-30"
                      ><Minus className="w-3.5 h-3.5" /></button>
                      <span className="w-5 text-center text-sm font-semibold">{current}</span>
                      <button
                        onClick={() => setQ(tt.id, +1, maxAllowed)}
                        disabled={current >= maxAllowed}
                        className="w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-30"
                      ><Plus className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {event.terms && (
          <details className="bg-card border border-border rounded-lg p-3">
            <summary className="text-sm font-semibold cursor-pointer">Terms & Conditions</summary>
            <p className="text-xs text-muted-foreground mt-2 whitespace-pre-wrap">{event.terms}</p>
          </details>
        )}
      </div>

      {items.length > 0 && (
        <div className="fixed bottom-0 inset-x-0 bg-card border-t border-border p-4 shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-muted-foreground">Total</span>
            <span className="text-lg font-bold">₦{total.toLocaleString()}</span>
          </div>
          <Button onClick={handleBuy} disabled={submitting} className="w-full">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Pay with Wallet'}
          </Button>
        </div>
      )}
    </div>
  );
}
