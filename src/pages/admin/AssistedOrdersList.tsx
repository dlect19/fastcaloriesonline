import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Search, Headphones, Copy, MessageCircle } from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/hooks/use-toast';

type Row = {
  id: string;
  order_id: string;
  customer_channel: string;
  payment_status: string;
  payment_method: string;
  payment_link: string | null;
  bank_transfer_instructions: string | null;
  created_at: string;
  orders: {
    order_number: string;
    status: string;
    total: number;
    receiver_name: string | null;
    receiver_phone: string | null;
    delivery_address_text: string | null;
    vendor_id: string;
    user_id: string | null;
    vendors: { name: string } | null;
    profiles: { full_name: string | null; phone: string | null } | null;
  } | null;
};

export default function AssistedOrdersList() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const load = async () => {
    setLoading(true);
    let q = supabase
      .from('assisted_orders')
      .select(`
        id, order_id, customer_channel, payment_status, payment_method, payment_link, bank_transfer_instructions, created_at,
        orders:order_id (
          order_number, status, total, receiver_name, receiver_phone, delivery_address_text, vendor_id, user_id,
          vendors:vendor_id ( name ),
          profiles!orders_user_id_fkey ( full_name, phone )
        )
      `)
      .order('created_at', { ascending: false })
      .limit(200);

    if (statusFilter !== 'all') q = q.eq('payment_status', statusFilter);

    const { data, error } = await q;
    if (error) console.error(error);
    setRows((data || []) as any);
    setLoading(false);
  };

  useEffect(() => { load(); }, [statusFilter]);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      r.orders?.order_number?.toLowerCase().includes(s) ||
      r.orders?.receiver_name?.toLowerCase().includes(s) ||
      r.orders?.receiver_phone?.includes(s) ||
      r.orders?.profiles?.full_name?.toLowerCase().includes(s) ||
      r.orders?.profiles?.phone?.includes(s)
    );
  });

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      awaiting: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30',
      received: 'bg-green-500/10 text-green-700 border-green-500/30',
      failed: 'bg-red-500/10 text-red-700 border-red-500/30',
      cancelled: 'bg-gray-500/10 text-gray-700 border-gray-500/30',
    };
    return <Badge variant="outline" className={map[s] || ''}>{s}</Badge>;
  };

  const buildPaymentMessage = (r: Row): string => {
    const name = r.orders?.profiles?.full_name || r.orders?.receiver_name || 'there';
    const trackingUrl = `${window.location.origin}/track/${r.orders?.order_number}`;
    const total = `₦${Number(r.orders?.total || 0).toLocaleString()}`;
    if (r.payment_method === 'paystack_link' && r.payment_link) {
      return `Hi ${name}, thanks for ordering with FastCalories! 🍱\n\nOrder: ${r.orders?.order_number}\nTotal: ${total}\n\nPlease complete payment here:\n${r.payment_link}\n\nTrack your order anytime:\n${trackingUrl}\n\nReply to this message if you need anything. – FastCalories`;
    }
    if (r.payment_method === 'bank_transfer') {
      return `Hi ${name}, thanks for ordering with FastCalories! 🍱\n\nOrder: ${r.orders?.order_number}\nTotal: ${total}\n\n${r.bank_transfer_instructions || ''}\n\nOnce paid, send proof so we can release your order. Track here:\n${trackingUrl}\n\n– FastCalories`;
    }
    return `Hi ${name}, your FastCalories order ${r.orders?.order_number} (${total}) has been placed. Track here:\n${trackingUrl}`;
  };

  const copyText = async (txt: string, label = 'Copied') => {
    try { await navigator.clipboard.writeText(txt); toast({ title: label }); }
    catch { toast({ title: 'Copy failed', variant: 'destructive' }); }
  };

  const openWhatsApp = (r: Row) => {
    const phone = (r.orders?.profiles?.phone || r.orders?.receiver_phone || '').replace(/\D/g, '');
    // Convert Nigerian 0xxxxxxxxxx → 234xxxxxxxxxx for wa.me
    const intl = phone.startsWith('0') && phone.length === 11 ? '234' + phone.slice(1) : phone;
    const msg = encodeURIComponent(buildPaymentMessage(r));
    window.open(`https://wa.me/${intl}?text=${msg}`, '_blank');
  };

  return (
    <AdminLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><Headphones className="w-6 h-6" /> Assisted Orders</h1>
            <p className="text-muted-foreground text-sm">Concierge orders created by staff on behalf of customers.</p>
          </div>
          <Button onClick={() => navigate('/admin/assisted-orders/new')}>
            <Plus className="w-4 h-4 mr-2" /> Create Order
          </Button>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Filters</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[220px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search order #, customer, phone" className="pl-9" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All payment statuses</SelectItem>
                <SelectItem value="awaiting">Awaiting payment</SelectItem>
                <SelectItem value="received">Payment received</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : filtered.length === 0 ? (
              <div className="p-12 text-center text-muted-foreground">No assisted orders yet.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left">
                    <tr>
                      <th className="p-3">Order #</th>
                      <th className="p-3">Customer / Receiver</th>
                      <th className="p-3">Vendor</th>
                      <th className="p-3">Channel</th>
                      <th className="p-3">Payment</th>
                      <th className="p-3">Order Status</th>
                      <th className="p-3 text-right">Total</th>
                      <th className="p-3">Created</th>
                      <th className="p-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((r) => (
                      <tr key={r.id} className="border-t hover:bg-muted/20">
                        <td className="p-3 font-mono">{r.orders?.order_number}</td>
                        <td className="p-3">
                          <div className="font-medium">{r.orders?.profiles?.full_name || r.orders?.receiver_name || '—'}</div>
                          <div className="text-xs text-muted-foreground">{r.orders?.profiles?.phone || r.orders?.receiver_phone || ''}</div>
                        </td>
                        <td className="p-3">{r.orders?.vendors?.name || '—'}</td>
                        <td className="p-3 capitalize">{r.customer_channel}</td>
                        <td className="p-3">{statusBadge(r.payment_status)}</td>
                        <td className="p-3 capitalize">{r.orders?.status || '—'}</td>
                        <td className="p-3 text-right">₦{Number(r.orders?.total || 0).toLocaleString()}</td>
                        <td className="p-3 text-xs">{format(new Date(r.created_at), 'PP p')}</td>
                        <td className="p-3"><Link className="text-primary hover:underline" to={`/admin/assisted-orders/${r.order_id}`}>View</Link></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
