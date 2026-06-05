import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Calendar, MapPin } from 'lucide-react';
import { usePublishedEvents } from '@/hooks/useEvents';
import { format, parseISO } from 'date-fns';

export default function EventsList() {
  const navigate = useNavigate();
  const { events, loading } = usePublishedEvents();

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 bg-card border-b border-border px-4 py-3 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1.5 -ml-1.5 rounded hover:bg-secondary">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h1 className="text-lg font-bold">Events</h1>
      </header>

      <div className="p-4 space-y-3">
        {loading && <p className="text-sm text-muted-foreground">Loading events…</p>}
        {!loading && events.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-10">No upcoming events.</p>
        )}
        {events.map((e) => (
          <button
            key={e.id}
            onClick={() => navigate(`/events/${e.id}`)}
            className="w-full text-left bg-card border border-border rounded-xl overflow-hidden"
          >
            <div
              className="h-40 bg-cover bg-center bg-muted"
              style={{ backgroundImage: e.banner_url ? `url(${e.banner_url})` : undefined }}
            />
            <div className="p-3 space-y-1">
              <h3 className="font-semibold text-foreground">{e.name}</h3>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Calendar className="w-3 h-3" />
                <span>{format(parseISO(e.event_date), 'EEE, MMM d, yyyy')}{e.start_time ? ` · ${e.start_time.slice(0, 5)}` : ''}</span>
              </div>
              {e.location_text && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <MapPin className="w-3 h-3" />
                  <span>{e.location_text}</span>
                </div>
              )}
              {e.starting_price !== null && (
                <div className="text-sm font-semibold text-primary pt-1">From ₦{e.starting_price.toLocaleString()}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
