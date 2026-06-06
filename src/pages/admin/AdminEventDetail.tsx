import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Edit, Trash2, Gift } from 'lucide-react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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

interface VTForm {
  id?: string;
  ticket_type_id: string;
  name: string;
  vendor_id: string;
  combo_id: string;
  redemption_mode: 'venue' | 'delivery' | 'both';
  delivery_rule: 'free_food_paid_delivery' | 'free_food_free_delivery';
  sponsor: 'fastcalories' | 'vendor' | 'organizer';
  sponsor_cost_per_voucher: string;
  expires_hours_after_event: string;
  is_active: boolean;
}

const emptyTT: TTForm = {
  name: '', description: '', image_url: '', price: '', qty_available: '',
  max_per_customer: '10', sales_start: '', sales_end: '', is_active: true,
};

const emptyVT = (ticketTypeId: string): VTForm => ({
  ticket_type_id: ticketTypeId,
  name: 'Welcome Meal',
  vendor_id: '',
  combo_id: '',
  redemption_mode: 'both',
  delivery_rule: 'free_food_paid_delivery',
  sponsor: 'fastcalories',
  sponsor_cost_per_voucher: '0',
  expires_hours_after_event: '24',
  is_active: true,
});

export default function AdminEventDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { event, ticketTypes, loading, refetch } = useEvent(id);
  const [editing, setEditing] = useState<TTForm | null>(null);
  const [stats, setStats] = useState<{ sold: number; revenue: number; checked: number }>({ sold: 0, revenue: 0, checked: 0 });
  const { toast } = useToast();

  // Voucher templates state
  const [voucherTemplates, setVoucherTemplates] = useState<any[]>([]);
  const [editingVoucher, setEditingVoucher] = useState<VTForm | null>(null);
  const [vendors, setVendors] = useState<any[]>([]);
  const [combos, setCombos] = useState<any[]>([]);

  useEffect(() => {
    if (!id) return;
    (async () => {
      const { data: tickets } = await supabase.from('event_tickets').select('price, status').eq('event_id', id);
      const sold = (tickets || []).filter((t: any) => t.status !== 'cancelled').length;
      const revenue = (tickets || []).filter((t: any) => t.status !== 'cancelled').reduce((s: number, t: any) => s + Number(t.price), 0);
      const checked = (tickets || []).filter((t: any) => t.status === 'checked_in').length;
      setStats({ sold, revenue, checked });

      const { data: tpls } = await supabase
        .from('event_voucher_templates').select('*, vendors(name), combos(name)').eq('event_id', id);
      setVoucherTemplates(tpls || []);
    })();
  }, [id, ticketTypes]);

  useEffect(() => {
    (async () => {
      const { data: vs } = await supabase.from('vendors').select('id, name').eq('is_active', true).order('name');
      setVendors(vs || []);
    })();
  }, []);

  // Load combos for the selected vendor when editing a voucher template
  useEffect(() => {
    if (!editingVoucher?.vendor_id) { setCombos([]); return; }
    (async () => {
      const { data } = await supabase
        .from('combos').select('id, name, combo_price')
        .eq('vendor_id', editingVoucher.vendor_id).eq('is_available', true).order('name');
      setCombos(data || []);
    })();
  }, [editingVoucher?.vendor_id]);

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

  const saveVoucher = async () => {
    if (!editingVoucher || !id) return;
    if (!editingVoucher.name || !editingVoucher.vendor_id || !editingVoucher.combo_id) {
      return toast({ title: 'Name, vendor, and combo are required', variant: 'destructive' });
    }
    const payload: any = {
      event_id: id,
      ticket_type_id: editingVoucher.ticket_type_id,
      name: editingVoucher.name,
      vendor_id: editingVoucher.vendor_id,
      combo_id: editingVoucher.combo_id,
      redemption_mode: editingVoucher.redemption_mode,
      delivery_rule: editingVoucher.delivery_rule,
      sponsor: editingVoucher.sponsor,
      sponsor_cost_per_voucher: Number(editingVoucher.sponsor_cost_per_voucher) || 0,
      expires_hours_after_event: editingVoucher.expires_hours_after_event ? Number(editingVoucher.expires_hours_after_event) : null,
      is_active: editingVoucher.is_active,
    };
    if (editingVoucher.id) {
      const { error } = await supabase.from('event_voucher_templates').update(payload).eq('id', editingVoucher.id);
      if (error) return toast({ title: 'Save failed', description: error.message, variant: 'destructive' });
    } else {
      const { error } = await supabase.from('event_voucher_templates').insert(payload);
      if (error) return toast({ title: 'Create failed', description: error.message, variant: 'destructive' });
    }
    toast({ title: 'Voucher template saved', description: 'New ticket buyers will receive this voucher automatically.' });
    setEditingVoucher(null);
    const { data: tpls } = await supabase
      .from('event_voucher_templates').select('*, vendors(name), combos(name)').eq('event_id', id);
    setVoucherTemplates(tpls || []);
  };

  const removeVoucher = async (vtId: string) => {
    if (!confirm('Delete this voucher template? Already-issued vouchers stay valid.')) return;
    const { error } = await supabase.from('event_voucher_templates').delete().eq('id', vtId);
    if (error) return toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
    setVoucherTemplates(voucherTemplates.filter(v => v.id !== vtId));
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
          <div className="bg-card border border-border rounded-lg p-3"><p className="text-xs text-muted-foreground">Tickets Sold</p><p className="text-2xl font-bold">{stats.sold}</p></div>
          <div className="bg-card border border-border rounded-lg p-3"><p className="text-xs text-muted-foreground">Revenue</p><p className="text-2xl font-bold">₦{stats.revenue.toLocaleString()}</p></div>
          <div className="bg-card border border-border rounded-lg p-3"><p className="text-xs text-muted-foreground">Checked In</p><p className="text-2xl font-bold">{stats.checked}</p></div>
        </div>

        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold">Ticket Types</h2>
          <Button size="sm" onClick={() => setEditing({ ...emptyTT })}><Plus className="w-4 h-4 mr-1" /> Add Ticket</Button>
        </div>

        <div className="space-y-3">
          {ticketTypes.length === 0 && <p className="text-sm text-muted-foreground">No ticket types yet.</p>}
          {ticketTypes.map(tt => {
            const remaining = tt.qty_available - tt.qty_sold;
            const ttVouchers = voucherTemplates.filter(v => v.ticket_type_id === tt.id);
            return (
              <div key={tt.id} className="bg-card border border-border rounded-lg p-3">
                <div className="flex items-center gap-3">
                  {tt.image_url && <img src={tt.image_url} alt="" className="w-12 h-12 rounded object-cover" />}
                  <div className="flex-1">
                    <p className="font-semibold">{tt.name}</p>
                    <p className="text-xs text-muted-foreground">₦{Number(tt.price).toLocaleString()} · {tt.qty_sold}/{tt.qty_available} sold · {remaining} left</p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({
                    id: tt.id, name: tt.name, description: tt.description || '', image_url: tt.image_url || '',
                    price: tt.price.toString(), qty_available: tt.qty_available.toString(),
                    max_per_customer: tt.max_per_customer.toString(),
                    sales_start: tt.sales_start ? tt.sales_start.slice(0, 16) : '',
                    sales_end: tt.sales_end ? tt.sales_end.slice(0, 16) : '',
                    is_active: tt.is_active,
                  })}><Edit className="w-3 h-3" /></Button>
                  <Button size="sm" variant="ghost" onClick={() => remove(tt.id)}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                </div>

                {/* Vouchers attached to this ticket type */}
                <div className="mt-3 pl-2 border-l-2 border-primary/30">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                      <Gift className="w-3.5 h-3.5" /> Food Vouchers ({ttVouchers.length})
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setEditingVoucher(emptyVT(tt.id))}>
                      <Plus className="w-3 h-3 mr-1" /> Add Voucher
                    </Button>
                  </div>
                  {ttVouchers.length === 0 && <p className="text-[11px] text-muted-foreground">No vouchers — ticket buyers won't receive any food reward.</p>}
                  {ttVouchers.map(vt => (
                    <div key={vt.id} className="flex items-center gap-2 py-1.5 text-xs">
                      <span className="flex-1">
                        <span className="font-semibold">{vt.name}</span>
                        <span className="text-muted-foreground"> · {vt.vendors?.name} · {vt.combos?.name} · {vt.redemption_mode} · {vt.sponsor}</span>
                        {!vt.is_active && <span className="ml-1 text-orange-600">(inactive)</span>}
                      </span>
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setEditingVoucher({
                        id: vt.id, ticket_type_id: vt.ticket_type_id, name: vt.name,
                        vendor_id: vt.vendor_id || '', combo_id: vt.combo_id || '',
                        redemption_mode: vt.redemption_mode, delivery_rule: vt.delivery_rule,
                        sponsor: vt.sponsor, sponsor_cost_per_voucher: String(vt.sponsor_cost_per_voucher || 0),
                        expires_hours_after_event: vt.expires_hours_after_event != null ? String(vt.expires_hours_after_event) : '',
                        is_active: vt.is_active,
                      })}><Edit className="w-3 h-3" /></Button>
                      <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => removeVoucher(vt.id)}><Trash2 className="w-3 h-3 text-destructive" /></Button>
                    </div>
                  ))}
                </div>
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

        {editingVoucher && (
          <Dialog open onOpenChange={() => setEditingVoucher(null)}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editingVoucher.id ? 'Edit Voucher Template' : 'New Voucher Template'}</DialogTitle></DialogHeader>
              <div className="space-y-3">
                <div><Label>Voucher Name *</Label><Input value={editingVoucher.name} onChange={e => setEditingVoucher({ ...editingVoucher, name: e.target.value })} placeholder="VIP Welcome Meal" /></div>

                <div>
                  <Label>Vendor *</Label>
                  <Select value={editingVoucher.vendor_id} onValueChange={v => setEditingVoucher({ ...editingVoucher, vendor_id: v, combo_id: '' })}>
                    <SelectTrigger><SelectValue placeholder="Pick a vendor" /></SelectTrigger>
                    <SelectContent>{vendors.map(v => <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>

                <div>
                  <Label>Combo *</Label>
                  <Select value={editingVoucher.combo_id} onValueChange={v => setEditingVoucher({ ...editingVoucher, combo_id: v })} disabled={!editingVoucher.vendor_id}>
                    <SelectTrigger><SelectValue placeholder={editingVoucher.vendor_id ? 'Pick a combo' : 'Pick vendor first'} /></SelectTrigger>
                    <SelectContent>
                      {combos.map(c => <SelectItem key={c.id} value={c.id}>{c.name} — ₦{Number(c.combo_price).toLocaleString()}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Redemption Mode</Label>
                    <Select value={editingVoucher.redemption_mode} onValueChange={(v: any) => setEditingVoucher({ ...editingVoucher, redemption_mode: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="venue">Venue only</SelectItem>
                        <SelectItem value="delivery">Delivery only</SelectItem>
                        <SelectItem value="both">Both</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Delivery Rule</Label>
                    <Select value={editingVoucher.delivery_rule} onValueChange={(v: any) => setEditingVoucher({ ...editingVoucher, delivery_rule: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="free_food_paid_delivery">Free food, customer pays delivery</SelectItem>
                        <SelectItem value="free_food_free_delivery">Free food + free delivery</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Sponsor</Label>
                    <Select value={editingVoucher.sponsor} onValueChange={(v: any) => setEditingVoucher({ ...editingVoucher, sponsor: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fastcalories">FastCalories</SelectItem>
                        <SelectItem value="vendor">Vendor (self-funded)</SelectItem>
                        <SelectItem value="organizer">Event Organizer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Sponsor cost per voucher (₦)</Label>
                    <Input type="number" value={editingVoucher.sponsor_cost_per_voucher} onChange={e => setEditingVoucher({ ...editingVoucher, sponsor_cost_per_voucher: e.target.value })} />
                  </div>
                </div>

                <div>
                  <Label>Expires (hours after event end)</Label>
                  <Input type="number" placeholder="24" value={editingVoucher.expires_hours_after_event} onChange={e => setEditingVoucher({ ...editingVoucher, expires_hours_after_event: e.target.value })} />
                  <p className="text-[11px] text-muted-foreground mt-1">Leave blank to never expire.</p>
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editingVoucher.is_active} onChange={e => setEditingVoucher({ ...editingVoucher, is_active: e.target.checked })} />
                  Active (issued with new tickets)
                </label>

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="ghost" onClick={() => setEditingVoucher(null)}>Cancel</Button>
                  <Button onClick={saveVoucher}>Save</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </AdminLayout>
  );
}
