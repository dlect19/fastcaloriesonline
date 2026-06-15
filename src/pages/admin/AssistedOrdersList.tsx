import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Search, Headphones, Copy, MessageCircle, XCircle } from 'lucide-react';
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
    id: string;
    order_number: string;
    status: string;
    total: number;
    subtotal: number;
    delivery_fee: number;
    service_fee: number;
    packaging_fee: number;
    confirmation_code: string | null;
    receiver_name: string | null;
    receiver_phone: string | null;
    delivery_address_text: string | null;
    vendor_id: string;
    user_id: string | null;
    vendors: { name: string } | null;
    order_items: { product_name: string; quantity: number; unit_price: number; total_price: number; calories: number | null }[] | null;
  } | null;
  customer_profile?: { full_name: string | null; phone: string | null } | null;
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
          id, order_number, status, total, subtotal, delivery_fee, service_fee, packaging_fee, confirmation_code,
          receiver_name, receiver_phone, delivery_address_text, vendor_id, user_id,
          vendors:vendor_id ( name )
        )
      `)
      .order('created_at', { ascending: false })
      .limit(200);

    if (statusFilter !== 'all') q = q.eq('payment_status', statusFilter);

    const { data, error } = await q;
    if (error) console.error(error);
    const baseRows = (data || []) as unknown as Row[];

    // Fetch order items separately (no nested FK hint available)
    const orderIds = baseRows.map((r) => r.orders?.id).filter(Boolean) as string[];
    const itemsByOrder = new Map<string, any[]>();
    if (orderIds.length > 0) {
      const { data: items } = await supabase
        .from('order_items')
        .select('order_id, product_name, quantity, unit_price, total_price, calories')
        .in('order_id', orderIds);
      (items || []).forEach((it: any) => {
        const arr = itemsByOrder.get(it.order_id) || [];
        arr.push(it);
        itemsByOrder.set(it.order_id, arr);
      });
    }

    const userIds = [...new Set(baseRows.map((r) => r.orders?.user_id).filter(Boolean))] as string[];
    let profileMap = new Map<string, { full_name: string | null; phone: string | null }>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('user_id, full_name, phone')
        .in('user_id', userIds);
      profileMap = new Map((profiles || []).map((p: any) => [p.user_id, { full_name: p.full_name, phone: p.phone }]));
    }
    setRows(baseRows.map((r) => ({
      ...r,
      orders: r.orders ? { ...r.orders, order_items: (r.orders.id ? itemsByOrder.get(r.orders.id) : null) || [] } : null,
      customer_profile: r.orders?.user_id ? profileMap.get(r.orders.user_id) || null : null,
    } as Row)));
    setLoading(false);
  };

  const cancelOrder = async (r: Row) => {
    if (!confirm(`Cancel order ${r.orders?.order_number}? The payment link will be deactivated.`)) return;
    try {
      const { data, error } = await supabase.functions.invoke('assisted-order-verify-payment', {
        body: { order_id: r.order_id, action: 'cancel' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: 'Order cancelled', description: 'Payment link deactivated.' });
      load();
    } catch (e: any) {
      toast({ title: 'Cancel failed', description: e.message, variant: 'destructive' });
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      r.orders?.order_number?.toLowerCase().includes(s) ||
      r.orders?.receiver_name?.toLowerCase().includes(s) ||
      r.orders?.receiver_phone?.includes(s) ||
      r.customer_profile?.full_name?.toLowerCase().includes(s) ||
      r.customer_profile?.phone?.includes(s)
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
    const name = r.customer_profile?.full_name || r.orders?.receiver_name || 'there';
    const trackingUrl = `${window.location.origin}/track/${r.orders?.order_number}`;
    const total = `₦${Number(r.orders?.total || 0).toLocaleString()}`;
    const items = r.orders?.order_items || [];
    const itemsLines = items.map(it => {
      const cal = it.calories != null ? ` (${Number(it.calories) * Number(it.quantity)} kcal)` : '';
      return `• ${it.quantity} × ${it.product_name} — ₦${Number(it.total_price).toLocaleString()}${cal}`;
    }).join('\n');
    const totalCal = items.reduce((s, it) => s + (Number(it.calories || 0) * Number(it.quantity || 0)), 0);
    const calorieLine = totalCal > 0
      ? `\n🔥 Total calories: ${Math.round(totalCal)} kcal — about ${Math.round(totalCal/500)} meal portion${totalCal>1000?'s':''}. Enjoy mindfully!`
      : '';
    const otpLine = r.orders?.confirmation_code ? `\n🔐 Delivery OTP: *${r.orders.confirmation_code}* (share only with our rider on arrival)` : '';
    const receiptBlock = items.length ? `\n\n🧾 Order ${r.orders?.order_number}\n${itemsLines}\n— *Total: ${total}*${calorieLine}${otpLine}` : `\n\nOrder: ${r.orders?.order_number}\nTotal: ${total}${otpLine}`;
    if (r.payment_method === 'paystack_link' && r.payment_link) {
      return `Hi ${name}, thanks for ordering with FastCalories! 🍱${receiptBlock}\n\n💳 Pay securely here:\n${r.payment_link}\n\n📍 Track live:\n${trackingUrl}\n\n– FastCalories`;
    }
    if (r.payment_method === 'bank_transfer') {
      return `Hi ${name}, thanks for ordering with FastCalories! 🍱${receiptBlock}\n\n🏦 ${r.bank_transfer_instructions || ''}\n\nReply with proof of payment.\n📍 Track: ${trackingUrl}`;
    }
    return `Hi ${name}, your FastCalories order has been placed.${receiptBlock}\n📍 Track: ${trackingUrl}`;
  };

  const copyText = async (txt: string, label = 'Copied') => {
    try { await navigator.clipboard.writeText(txt); toast({ title: label }); }
    catch { toast({ title: 'Copy failed', variant: 'destructive' }); }
  };

  const openWhatsApp = (r: Row) => {
    const phone = (r.customer_profile?.phone || r.orders?.receiver_phone || '').replace(/\D/g, '');
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
                      <tr key={r.id} className="border-t hover:bg-muted/20 align-top">
                        <td className="p-3 font-mono whitespace-nowrap">{r.orders?.order_number}</td>
                        <td className="p-3">
                          <div className="font-medium">{r.customer_profile?.full_name || r.orders?.receiver_name || '—'}</div>
                          <div className="text-xs text-muted-foreground">{r.customer_profile?.phone || r.orders?.receiver_phone || ''}</div>
                          {r.orders?.user_id && <Badge variant="outline" className="mt-1 bg-blue-500/10 text-blue-700 border-blue-500/30 text-[10px]">App user</Badge>}
                        </td>
                        <td className="p-3">{r.orders?.vendors?.name || '—'}</td>
                        <td className="p-3 capitalize">{r.customer_channel}</td>
                        <td className="p-3">
                          {statusBadge(r.payment_status)}
                          <div className="text-[10px] text-muted-foreground mt-1 capitalize">{r.payment_method.replace('_',' ')}</div>
                          {r.payment_method === 'paystack_link' && r.payment_link && (
                            <div className="flex items-center gap-1 mt-1">
                              <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => copyText(r.payment_link!, 'Payment link copied')}>
                                <Copy className="w-3 h-3 mr-1" />Link
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => copyText(buildPaymentMessage(r), 'Message copied')}>
                                <Copy className="w-3 h-3 mr-1" />Msg
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 px-1 text-green-700" onClick={() => openWhatsApp(r)}>
                                <MessageCircle className="w-3 h-3 mr-1" />WA
                              </Button>
                            </div>
                          )}
                          {r.payment_method === 'bank_transfer' && (
                            <div className="flex items-center gap-1 mt-1">
                              <Button size="sm" variant="ghost" className="h-6 px-1" onClick={() => copyText(buildPaymentMessage(r), 'Message copied')}>
                                <Copy className="w-3 h-3 mr-1" />Msg
                              </Button>
                              <Button size="sm" variant="ghost" className="h-6 px-1 text-green-700" onClick={() => openWhatsApp(r)}>
                                <MessageCircle className="w-3 h-3 mr-1" />WA
                              </Button>
                            </div>
                          )}
                        </td>
                        <td className="p-3 capitalize">{r.orders?.status || '—'}</td>
                        <td className="p-3 text-right whitespace-nowrap">₦{Number(r.orders?.total || 0).toLocaleString()}</td>
                        <td className="p-3 text-xs whitespace-nowrap">{format(new Date(r.created_at), 'PP p')}</td>
                        <td className="p-3 space-y-1 whitespace-nowrap">
                          <Link className="text-primary hover:underline block" to={`/admin/assisted-orders/${r.order_id}`}>View</Link>
                          {r.payment_status === 'awaiting' && (
                            <Button size="sm" variant="ghost" className="h-6 px-1 text-destructive" onClick={() => cancelOrder(r)}>
                              <XCircle className="w-3 h-3 mr-1" />Cancel
                            </Button>
                          )}
                        </td>
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
