import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { CalendarHeart, LogOut, Loader2, Hourglass, CheckCircle2, ExternalLink, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import OrganizerWalletSection from '@/components/organizer/OrganizerWalletSection';
import { format, parseISO } from 'date-fns';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

export default function OrganizerDashboard() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [organizer, setOrganizer] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) { navigate('/organizer/auth', { replace: true }); return; }
    const { data: org } = await supabase
      .from('event_organizers')
      .select('*')
      .eq('owner_user_id', session.user.id)
      .maybeSingle();
    if (!org) {
      // signed in but no organizer linked
      setOrganizer(null);
      setLoading(false);
      return;
    }
    setOrganizer(org);
    const { data: evs } = await supabase
      .from('events')
      .select('id, name, event_date, status, organizer_access_token, banner_url')
      .eq('organizer_id', org.id)
      .order('event_date', { ascending: false });
    setEvents(evs || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const logout = async () => {
    await supabase.auth.signOut();
    navigate('/organizer/auth', { replace: true });
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!organizer) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-card border border-border rounded-2xl p-6 text-center space-y-3">
          <h2 className="text-lg font-bold">No organizer profile linked</h2>
          <p className="text-sm text-muted-foreground">Your account isn't connected to an event organizer. Sign up as a planner, or contact admin.</p>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={logout}>Log out</Button>
            <Button onClick={() => navigate('/organizer/auth')}>Sign up</Button>
          </div>
        </div>
      </div>
    );
  }

  const approved = organizer.is_active;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 bg-card/80 backdrop-blur border-b border-border">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <img src={fastCaloriesLogo} alt="Fast Calories" className="w-9 h-9 rounded-lg shrink-0" />
            <div className="min-w-0">
              <h1 className="text-sm font-bold truncate flex items-center gap-1">
                {organizer.name}
                <span className="text-[10px] text-muted-foreground font-normal">· Fast Calories Events</span>
              </h1>
              <p className="text-[11px] text-muted-foreground truncate">{organizer.contact_email}</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={logout}>
            <LogOut className="w-4 h-4 mr-1.5" />Log out
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-4">
        {!approved && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-start gap-3">
            <Hourglass className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-amber-900">Pending admin approval</p>
              <p className="text-amber-800/90 text-xs mt-0.5">
                You can already set up your bank details below. Your events go live and ticket sales settle once Fast Calories admin approves your profile.
              </p>
            </div>
          </div>
        )}
        {approved && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 flex items-center gap-2 text-sm text-emerald-900">
            <CheckCircle2 className="w-4 h-4" /> Your organizer profile is active.
          </div>
        )}

        {/* Wallet & bank account — reuses self-service mode */}
        <OrganizerWalletSection token="self" />

        {/* Events */}
        <section className="bg-card border border-border rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold flex items-center gap-2"><Calendar className="w-4 h-4" />My Events</h2>
            <span className="text-xs text-muted-foreground">{events.length} total</span>
          </div>
          {events.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">
              No events yet. Admin will create your first event from the Fast Calories backend.
            </p>
          ) : (
            <div className="space-y-2">
              {events.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-2 border border-border/60 rounded-lg p-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{e.name}</p>
                    <p className="text-[11px] text-muted-foreground">
                      {e.event_date ? format(parseISO(e.event_date), 'EEE, MMM d, yyyy') : '—'} · {e.status || 'draft'}
                    </p>
                  </div>
                  {e.organizer_access_token && (
                    <Link
                      to={`/organizer/${e.organizer_access_token}`}
                      className="text-xs text-primary inline-flex items-center gap-1 shrink-0"
                    >
                      Event portal <ExternalLink className="w-3 h-3" />
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
