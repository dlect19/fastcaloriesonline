import { useEffect, useState } from 'react';
import { Plus, Edit, Pause, Play, X, BarChart3, QrCode, LineChart } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ImageUploadField } from '@/components/admin/ImageUploadField';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { format, parseISO } from 'date-fns';

interface EventForm {
  id?: string;
  name: string;
  banner_url: string;
  description: string;
  location_text: string;
  event_date: string;
  start_time: string;
  end_time: string;
  organizer: string;
  organizer_id: string;
  capacity: string;
  terms: string;
  status: string;
}

const empty: EventForm = {
  name: '', banner_url: '', description: '', location_text: '',
  event_date: '', start_time: '', end_time: '', organizer: '', organizer_id: '',
  capacity: '', terms: '', status: 'draft',
};

export default function AdminEvents() {
  const [events, setEvents] = useState<any[]>([]);
  const [organizers, setOrganizers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<EventForm | null>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  const load = async () => {
    setLoading(true);
    const [{ data: evs }, { data: orgs }] = await Promise.all([
      supabase.from('events').select('*, event_organizers(id, name)').order('event_date', { ascending: false }),
      supabase.from('event_organizers').select('id, name, owner_user_id, contact_email').eq('is_active', true).order('name'),
    ]);
    setEvents(evs || []);
    setOrganizers(orgs || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!editing) return;
    const linkedOrg = organizers.find(o => o.id === editing.organizer_id);
    const payload: any = {
      name: editing.name,
      banner_url: editing.banner_url || null,
      description: editing.description || null,
      location_text: editing.location_text || null,
      event_date: editing.event_date,
      start_time: editing.start_time || null,
      end_time: editing.end_time || null,
      organizer: editing.organizer || linkedOrg?.name || null,
      organizer_id: editing.organizer_id || null,
      organizer_user_id: linkedOrg?.owner_user_id || null,
      capacity: editing.capacity ? Number(editing.capacity) : null,
      terms: editing.terms || null,
      status: editing.status as any,
    };
    if (!payload.name || !payload.event_date) {
      toast({ title: 'Name and date are required', variant: 'destructive' });
      return;
    }
    if (editing.id) {
      const { error } = await supabase.from('events').update(payload).eq('id', editing.id);
      if (error) return toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      const { error } = await supabase.from('events').insert(payload);
      if (error) return toast({ title: 'Create failed', description: error.message, variant: 'destructive' });
    }
    toast({ title: 'Saved' });
    setEditing(null);
    load();
  };

  const setStatus = async (id: string, status: string) => {
    const { error } = await supabase.from('events').update({ status: status as any }).eq('id', id);
    if (error) return toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    load();
  };

  return (
    <AdminLayout>
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Events</h1>
            <p className="text-sm text-muted-foreground">Manage events, ticket types, and check-ins</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/admin/event-verify')}>
              <QrCode className="w-4 h-4 mr-2" /> Verify Tickets
            </Button>
            <Button onClick={() => setEditing({ ...empty })}>
              <Plus className="w-4 h-4 mr-2" /> New Event
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : events.length === 0 ? (
          <p className="text-muted-foreground text-center py-10">No events yet. Create your first event.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {events.map(e => (
              <div key={e.id} className="bg-card border border-border rounded-xl overflow-hidden">
                <div className="h-32 bg-cover bg-center bg-muted" style={{ backgroundImage: e.banner_url ? `url(${e.banner_url})` : undefined }} />
                <div className="p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{e.name}</p>
                      <p className="text-xs text-muted-foreground">{format(parseISO(e.event_date), 'MMM d, yyyy')}{e.start_time ? ` · ${e.start_time.slice(0,5)}` : ''}</p>
                      {e.event_organizers?.name ? (
                        <p className="text-[11px] text-primary mt-0.5">Linked to: {e.event_organizers.name}</p>
                      ) : e.organizer ? (
                        <p className="text-[11px] text-muted-foreground mt-0.5">Organizer: {e.organizer} (not linked)</p>
                      ) : null}
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium capitalize ${
                      e.status === 'published' ? 'bg-green-500/10 text-green-600' :
                      e.status === 'paused' ? 'bg-orange-500/10 text-orange-600' :
                      e.status === 'cancelled' ? 'bg-destructive/10 text-destructive' :
                      'bg-muted text-muted-foreground'
                    }`}>{e.status}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => navigate(`/admin/events/${e.id}/dashboard`)}>
                      <LineChart className="w-3 h-3 mr-1" /> Dashboard
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => navigate(`/admin/events/${e.id}`)}>
                      <BarChart3 className="w-3 h-3 mr-1" /> Manage
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing({
                      id: e.id, name: e.name, banner_url: e.banner_url || '', description: e.description || '',
                      location_text: e.location_text || '', event_date: e.event_date, start_time: e.start_time || '',
                      end_time: e.end_time || '', organizer: e.organizer || '', organizer_id: e.organizer_id || '',
                      capacity: e.capacity?.toString() || '',
                      terms: e.terms || '', status: e.status,
                    })}>
                      <Edit className="w-3 h-3 mr-1" /> Edit
                    </Button>
                    {e.status === 'draft' && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(e.id, 'published')}>
                        <Play className="w-3 h-3 mr-1" /> Publish
                      </Button>
                    )}
                    {e.status === 'published' && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(e.id, 'paused')}>
                        <Pause className="w-3 h-3 mr-1" /> Pause
                      </Button>
                    )}
                    {e.status === 'paused' && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(e.id, 'published')}>
                        <Play className="w-3 h-3 mr-1" /> Resume
                      </Button>
                    )}
                    {e.status !== 'cancelled' && (
                      <Button size="sm" variant="ghost" onClick={() => setStatus(e.id, 'cancelled')}>
                        <X className="w-3 h-3 mr-1" /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <Dialog open onOpenChange={() => setEditing(null)}>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>{editing.id ? 'Edit Event' : 'New Event'}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name *</Label><Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} /></div>
              <ImageUploadField label="Banner image" value={editing.banner_url} onChange={(url) => setEditing({ ...editing, banner_url: url })} folder="event-banners" />
              <div><Label>Description</Label><Textarea rows={3} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></div>
              <div><Label>Location</Label><Input value={editing.location_text} onChange={e => setEditing({ ...editing, location_text: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-3">
                <div><Label>Date *</Label><Input type="date" value={editing.event_date} onChange={e => setEditing({ ...editing, event_date: e.target.value })} /></div>
                <div><Label>Start time</Label><Input type="time" value={editing.start_time} onChange={e => setEditing({ ...editing, start_time: e.target.value })} /></div>
                <div><Label>End time</Label><Input type="time" value={editing.end_time} onChange={e => setEditing({ ...editing, end_time: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Link to Event Planner account</Label>
                  <select
                    className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                    value={editing.organizer_id}
                    onChange={e => {
                      const id = e.target.value;
                      const org = organizers.find(o => o.id === id);
                      setEditing({ ...editing, organizer_id: id, organizer: org?.name || editing.organizer });
                    }}
                  >
                    <option value="">— None (unlinked) —</option>
                    {organizers.map(o => (
                      <option key={o.id} value={o.id}>
                        {o.name}{o.contact_email ? ` · ${o.contact_email}` : ''}{!o.owner_user_id ? ' (no user yet)' : ''}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Picking a planner lets them see & manage this event from their Organizer Dashboard.
                  </p>
                </div>
                <div><Label>Capacity</Label><Input type="number" value={editing.capacity} onChange={e => setEditing({ ...editing, capacity: e.target.value })} /></div>
              </div>
              <div>
                <Label>Organizer display name (shown on event page)</Label>
                <Input value={editing.organizer} onChange={e => setEditing({ ...editing, organizer: e.target.value })} placeholder="Auto-filled from linked planner" />
              </div>
              <div><Label>Terms & Conditions</Label><Textarea rows={3} value={editing.terms} onChange={e => setEditing({ ...editing, terms: e.target.value })} /></div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                <Button onClick={save}>Save</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </AdminLayout>
  );
}
