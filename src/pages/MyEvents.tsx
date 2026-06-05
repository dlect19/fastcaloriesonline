import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, Ticket, CheckCircle } from 'lucide-react';
import { useMyTickets } from '@/hooks/useEvents';
import { TicketQrDialog } from '@/components/events/TicketQrDialog';
import { format, parseISO } from 'date-fns';

export default function MyEvents() {
  const navigate = useNavigate();
  const { tickets, loading } = useMyTickets();
  const [openTicket, setOpenTicket] = useState<any>(null);

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="sticky top-0 z-20 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 -ml-1.5 rounded hover:bg-secondary">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold">My Events</h1>
      </header>

      <div className="p-4 space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Loading…</p>}
        {!loading && tickets.length === 0 && (
          <div className="text-center py-16">
            <Ticket className="w-12 h-12 mx-auto text-muted-foreground mb-2" />
            <p className="text-sm text-muted-foreground">You haven't purchased any tickets yet.</p>
          </div>
        )}
        {tickets.map((t) => {
          const e = t.events;
          return (
            <button
              key={t.id}
              onClick={() => setOpenTicket(t)}
              className="w-full text-left bg-card border border-border rounded-xl p-3 flex gap-3 items-center"
            >
              <div
                className="w-16 h-16 rounded-lg bg-cover bg-center bg-muted flex-shrink-0"
                style={{ backgroundImage: e?.banner_url ? `url(${e.banner_url})` : undefined }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm line-clamp-1">{e?.name}</p>
                <p className="text-xs text-muted-foreground">{t.event_ticket_types?.name}</p>
                {e?.event_date && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                    <Calendar className="w-3 h-3" />
                    <span>{format(parseISO(e.event_date), 'MMM d, yyyy')}</span>
                  </div>
                )}
                <div className="mt-1">
                  {t.status === 'checked_in' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-600 font-medium">
                      <CheckCircle className="w-3 h-3" /> Checked in
                    </span>
                  ) : t.status === 'unused' ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium">Ready to use</span>
                  ) : (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium capitalize">{t.status}</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {openTicket && (
        <TicketQrDialog ticket={openTicket} onClose={() => setOpenTicket(null)} />
      )}
    </div>
  );
}
