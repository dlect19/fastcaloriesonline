import { useNavigate } from 'react-router-dom';
import { Calendar, MapPin } from 'lucide-react';
import { usePublishedEvents } from '@/hooks/useEvents';
import { format, parseISO } from 'date-fns';

export function EventsCarousel() {
  const navigate = useNavigate();
  const { events, loading } = usePublishedEvents();

  if (loading || events.length === 0) return null;

  return (
    <section className="px-4 py-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-bold text-foreground">Events Near You</h2>
        <button
          onClick={() => navigate('/events')}
          className="text-xs text-primary font-medium"
        >
          See all
        </button>
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x snap-mandatory scrollbar-hide">
        {events.map((e) => (
          <button
            key={e.id}
            onClick={() => navigate(`/events/${e.id}`)}
            className="flex-shrink-0 w-72 snap-start text-left bg-card border border-border rounded-xl overflow-hidden hover:shadow-md transition-shadow"
          >
            <div
              className="h-32 bg-cover bg-center bg-muted"
              style={{ backgroundImage: e.banner_url ? `url(${e.banner_url})` : undefined }}
            />
            <div className="p-3 space-y-1">
              <h3 className="font-semibold text-sm text-foreground line-clamp-1">{e.name}</h3>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Calendar className="w-3 h-3" />
                <span>{format(parseISO(e.event_date), 'MMM d, yyyy')}</span>
              </div>
              {e.location_text && (
                <div className="flex items-center gap-1 text-xs text-muted-foreground line-clamp-1">
                  <MapPin className="w-3 h-3" />
                  <span>{e.location_text}</span>
                </div>
              )}
              {e.starting_price !== null && (
                <div className="text-xs font-semibold text-primary pt-1">
                  From ₦{e.starting_price.toLocaleString()}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
