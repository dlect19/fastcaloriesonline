import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Edit, Trash2 } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useEvent } from '@/hooks/useEvents';

interface TTForm {
  id?: string;
  name: string;
  description: string;
  image_url: string;
  price: string;
  qty_available: string;
  max_per_customer: string;
  sales_start: string;
  sales_end: string;
  is_active: boolean;
}

const emptyTT: TTForm = {
  name: '', description: '', image_url: '', price: '', qty_available: '',
  max_per_customer: '10', sales_start: '', sales_end: '', is_active: true,
};

export default function AdminEventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { event, ticketTypes, loading, refetch } = useEvent(id);
  const [editing, setEditing] = useState<TTForm | null>(null);
  const [stats, setStats] = useState<{ sold: number; revenue: number; checked: number }>({ sold: 0, revenue: 0, checked: 0 });
  const { toast } = useToast();

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: tickets } = await supabase.from('event_tickets').select('price, status').eq('event_id', id);
      const sold = (tickets || []).filter((t: any) => t.status !== 'cancelled').length;
      const revenue = (tickets || []).filter((t: any) => t.status !== 'cancelled').reduce((s: number, t: any) => s + Number(t.price), 0);
      const checked = (tickets || []).filter((t: any) => t.status === 'checked_in').length;
      setStats({ sold, revenue, checked });
    })();
  }, [id, ticketTypes]);

  const save = async () => {
    if (!editing || !id) return;
    if (!editing.name || !editing.price || !editing.qty_available) {
      return toast({ title: 'Name, price, and quantity are required', variant: 'destructive' });
    }
    const payload: any = {
      event_id: id,
      name: editing.name,
      description: editing.description || null,
      image_url: editing.image_url || null,
      price: Number(editing.price),
      qty_available: Number(editing.qty_available),
      max_per_customer: Number(editing.max_per_customer) || 10,
      sales_start: editing.sales_start || null,
      sales_end: editing.sales_end || null,
      is_active: editing.is_active,
    };
    if (editing.id) {
      const { error } = await supabase.from('event_ticket_types').update(payload).eq('id', editing.id);
      if (error) return toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      const { error } = await supabase.from('event_ticket_types').insert(payload);
      if (error) return toast({ title: 'Create failed', description: error.message, variant: 'destructive' });
    }
    toast({ title: 'Saved' });
    setEditing(null);
    refetch();
  };

  const remove = async (ttId: string) => {
    if (!confirm('Delete this ticket type?')) return;
    const { error } = await supabase.from('event_ticket_types').delete().eq('id', ttId);
    if (error) return toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
    refetch();
  };

  if (loading) return <AdminLayout><p>Loading…</p></AdminLayout>;
  if (!event) return <AdminLayout><p>Event not found</p></AdminLayout>;

  return (
    <AdminLayout>
      <div className="max-w-5xl mx-auto">
        <button onClick={() => navigate('/admin/events')} className="flex items-center gap-2 text-sm text-muted-foreground mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to Events
        </button>

        <div className="mb-6">
          <h1 className="text-2xl font-bold">{event.name}</h1>
          <p className="text-sm text-muted-foreground capitalize">Status: {event.status}</p>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Tickets Sold</p>
            <p className="text-2xl font-bold">{stats.sold}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Revenue</p>
            <p className="text-2xl font-bold">₦{stats.revenue.toLocaleString()}</p>
          </div>
          <div className="bg-card border border-border rounded-lg p-3">
            <p className="text-xs text-muted-foreground">Checked In</p>
            <p className="text-2xl font-bold">{stats.checked}</p>
          </div>
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">Ticket Types</h2>
          <Button size="sm" onClick={() => setEditing({ ...emptyTT })}>
            <Plus className="w-4 h-4 mr-1" /> Add Ticket
          </Button>
        </div>

        <div className="space-y-2">
          {ticketTypes.length === 0 && <p className="text-sm text-muted-foreground">No ticket types yet.</p>}
          {ticketTypes.map(tt => {
            const remaining = tt.qty_available - tt.qty_sold;
            return (
              <div key={tt.id} className="bg-card border border-border rounded-lg p-3 flex items-center gap-3">
                {tt.image_url && <img src={tt.image_url} alt="" className="w-12 h-12 rounded object-cover" />}
                <div className="flex-1">
                  <p className="font-semibold">{tt.name}</p>
                  <p className="text-xs text-muted-foreground">
                    ₦{Number(tt.price).toLocaleString()} · {tt.qty_sold}/{tt.qty_available} sold · {remaining} left
                  </p>
                </div>
                <Button size="sm" variant="ghost" onClick={() => setEditing({
                  id: tt.id, name: tt.name, description: tt.description || '', image_url: tt.image_url || '',
                  price: tt.price.toString(), qty_available: tt.qty_available.toString(),
                  max_per_customer: tt.max_per_customer.toString(),
                  sales_start: tt.sales_start ? tt.sales_start.slice(0, 16) : '',
                  sales_end: tt.sales_end ? tt.sales_end.slice(0, 16) : '',
                  is_active: tt.is_active,
                })}>
                  <Edit className="w-3 h-3" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(tt.id)}>
                  <Trash2 className="w-3 h-3 text-destructive" />
                </Button>
              </div>
            );
          })}
        </div>

        {editing && (
          <Dialog open onOpenChange={() => setEditing(null)}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editing.id ? 'Edit Ticket Type' : 'New Ticket Type'}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Name *</Label><Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="VIP, Regular, etc." /></div>
                <div><Label>Description</Label><Textarea rows={2} value={editing.description} onChange={e => setEditing({ ...editing, description: e.target.value })} /></div>
                <div><Label>Image URL</Label><Input value={editing.image_url} onChange={e => setEditing({ ...editing, image_url: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Price (₦) *</Label><Input type="number" value={editing.price} onChange={e => setEditing({ ...editing, price: e.target.value })} /></div>
                  <div><Label>Quantity *</Label><Input type="number" value={editing.qty_available} onChange={e => setEditing({ ...editing, qty_available: e.target.value })} /></div>
                </div>
                <div><Label>Max per customer</Label><Input type="number" value={editing.max_per_customer} onChange={e => setEditing({ ...editing, max_per_customer: e.target.value })} /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Sales start</Label><Input type="datetime-local" value={editing.sales_start} onChange={e => setEditing({ ...editing, sales_start: e.target.value })} /></div>
                  <div><Label>Sales end</Label><Input type="datetime-local" value={editing.sales_end} onChange={e => setEditing({ ...editing, sales_end: e.target.value })} /></div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editing.is_active} onChange={e => setEditing({ ...editing, is_active: e.target.checked })} />
                  Active (visible to customers)
                </label>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
                  <Button onClick={save}>Save</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </AdminLayout>
  );
}
