import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ArrowLeft, Copy, CheckCircle2, RefreshCw, MessageCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { format } from 'date-fns';

export default function AssistedOrderDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<any>(null);
  const [audit, setAudit] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    if (!orderId) return;
    setLoading(true);
    const { data: ao } = await supabase
      .from('assisted_orders')
      .select(`
        *,
        orders:order_id (
          *,
          order_items ( * ),
          vendors:vendor_id ( name ),
          profiles!orders_user_id_fkey ( full_name, phone )
        )
      `)
      .eq('order_id', orderId)
      .maybeSingle();
    setData(ao);
    const { data: a } = await supabase
      .from('assisted_order_audit')
      .select('*')
      .eq('order_id', orderId)
      .order('created_at', { ascending: false });
    setAudit(a || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [orderId]);

  const copy = (txt: string) => { navigator.clipboard.writeText(txt); toast({ title: 'Copied' }); };

  const callFn = async (fn: string, body: any) => {
    setBusy(fn);
    try {
      const { data: resp, error } = await supabase.functions.invoke(fn, { body });
      if (error) throw error;
      if (resp?.error) throw new Error(resp.error);
      toast({ title: 'Done', description: resp?.message || 'Action completed' });
      await load();
    } catch (e: any) {
      toast({ title: 'Failed', description: e.message || String(e), variant: 'destructive' });
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <AdminLayout><div className="p-12 flex justify-center"><Loader2 className="w-6 h-6 animate-spin" /></div></AdminLayout>;
  if (!data) return <AdminLayout><div className="p-12 text-center">Order not found.</div></AdminLayout>;

  const o = data.orders;
  const trackingUrl = `${window.location.origin}/track/${o?.order_number}`;
  const paidBadge = (s: string) => {
    const map: Record<string, string> = {
      awaiting: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/30',
      received: 'bg-green-500/10 text-green-700 border-green-500/30',
      failed: 'bg-red-500/10 text-red-700 border-red-500/30',
      cancelled: 'bg-gray-500/10 text-gray-700 border-gray-500/30',
    };
    return <Badge variant="outline" className={map[s] || ''}>{s}</Badge>;
  };

  return (
    <AdminLayout>
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/admin/assisted-orders')}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <h1 className="text-2xl font-bold">Order #{o.order_number}</h1>
          <Badge variant="outline" className="capitalize">{o.status}</Badge>
          {paidBadge(data.payment_status)}
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader><CardTitle>Customer</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div><span className="text-muted-foreground">Name:</span> {o.profiles?.full_name || '—'}</div>
              <div><span className="text-muted-foreground">Phone:</span> {o.profiles?.phone || '—'}</div>
              {o.receiver_name && <>
                <div className="pt-2 border-t mt-2"><span className="text-muted-foreground">Receiver:</span> {o.receiver_name}</div>
                <div><span className="text-muted-foreground">Receiver phone:</span> {o.receiver_phone}</div>
              </>}
              <div className="pt-2 border-t mt-2"><span className="text-muted-foreground">Channel:</span> <span className="capitalize">{data.customer_channel}</span></div>
              {data.channel_reference && <div><span className="text-muted-foreground">Ref:</span> {data.channel_reference}</div>}
              {o.communication_notes && (
                <div className="pt-2 border-t mt-2">
                  <div className="text-muted-foreground">Notes:</div>
                  <div className="whitespace-pre-wrap">{o.communication_notes}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Vendor & Delivery</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div><span className="text-muted-foreground">Vendor:</span> {o.vendors?.name}</div>
              <div><span className="text-muted-foreground">Type:</span> {o.delivery_type === 'self_pickup' ? 'Carryout' : 'Delivery'}</div>
              {o.delivery_address_text && <div><span className="text-muted-foreground">Address:</span> {o.delivery_address_text}</div>}
              {o.confirmation_code && (
                <div className="pt-2 border-t mt-2">
                  <span className="text-muted-foreground">Delivery OTP:</span> <span className="font-mono font-bold">{o.confirmation_code}</span>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle>Items</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead className="text-left bg-muted/40">
                <tr><th className="p-2">Product</th><th className="p-2">Qty</th><th className="p-2">Price</th><th className="p-2 text-right">Total</th></tr>
              </thead>
              <tbody>
                {(o.order_items || []).map((it: any) => (
                  <tr key={it.id} className="border-t">
                    <td className="p-2">
                      <div>{it.product_name}</div>
                      {it.special_instructions && <div className="text-xs text-muted-foreground">{it.special_instructions}</div>}
                    </td>
                    <td className="p-2">{it.quantity}</td>
                    <td className="p-2">₦{Number(it.unit_price).toLocaleString()}</td>
                    <td className="p-2 text-right">₦{Number(it.total_price).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t">
                <tr><td colSpan={3} className="p-2 text-right text-muted-foreground">Subtotal</td><td className="p-2 text-right">₦{Number(o.subtotal).toLocaleString()}</td></tr>
                {Number(o.delivery_fee) > 0 && <tr><td colSpan={3} className="p-2 text-right text-muted-foreground">Delivery Fee</td><td className="p-2 text-right">₦{Number(o.delivery_fee).toLocaleString()}</td></tr>}
                {Number(o.service_fee) > 0 && <tr><td colSpan={3} className="p-2 text-right text-muted-foreground">Service Fee</td><td className="p-2 text-right">₦{Number(o.service_fee).toLocaleString()}</td></tr>}
                <tr><td colSpan={3} className="p-2 text-right font-bold">Total</td><td className="p-2 text-right font-bold">₦{Number(o.total).toLocaleString()}</td></tr>
              </tfoot>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Payment & Tracking</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div><span className="text-muted-foreground">Method:</span> <span className="capitalize">{data.payment_method.replace('_',' ')}</span></div>
            {data.payment_link && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Payment link:</span>
                <a className="text-primary hover:underline truncate max-w-md" href={data.payment_link} target="_blank" rel="noreferrer">{data.payment_link}</a>
                <Button size="icon" variant="ghost" onClick={() => copy(data.payment_link)}><Copy className="w-4 h-4" /></Button>
              </div>
            )}
            {data.bank_transfer_instructions && (
              <div>
                <div className="text-muted-foreground">Bank Transfer Instructions:</div>
                <pre className="whitespace-pre-wrap text-xs bg-muted/30 p-3 rounded">{data.bank_transfer_instructions}</pre>
              </div>
            )}
            <div className="flex items-center gap-2 pt-2 border-t">
              <span className="text-muted-foreground">Tracking link:</span>
              <a className="text-primary hover:underline" href={trackingUrl} target="_blank" rel="noreferrer">{trackingUrl}</a>
              <Button size="icon" variant="ghost" onClick={() => copy(trackingUrl)}><Copy className="w-4 h-4" /></Button>
            </div>
            <div className="flex flex-wrap gap-2 pt-3 border-t">
              {data.payment_status === 'awaiting' && (
                <Button onClick={() => callFn('assisted-order-verify-payment', { order_id: orderId, action: 'mark_paid' })} disabled={busy !== null}>
                  {busy === 'assisted-order-verify-payment' ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                  Mark Payment Received
                </Button>
              )}
              <Button variant="outline" onClick={() => callFn('assisted-order-notify', { order_id: orderId, action: 'resend_payment_link' })} disabled={busy !== null || data.payment_status !== 'awaiting'}>
                <RefreshCw className="w-4 h-4 mr-2" /> Resend Payment Link
              </Button>
              <Button variant="outline" onClick={() => callFn('assisted-order-notify', { order_id: orderId, action: 'resend_otp' })} disabled={busy !== null || !o.confirmation_code}>
                <RefreshCw className="w-4 h-4 mr-2" /> Resend Delivery OTP
              </Button>
              <Button variant="outline" onClick={() => callFn('assisted-order-notify', { order_id: orderId, action: 'send_tracking' })} disabled={busy !== null}>
                <RefreshCw className="w-4 h-4 mr-2" /> Resend Tracking Link
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Audit Trail</CardTitle></CardHeader>
          <CardContent>
            {audit.length === 0 ? (
              <div className="text-sm text-muted-foreground">No events yet.</div>
            ) : (
              <ul className="space-y-2 text-sm">
                {audit.map((e) => (
                  <li key={e.id} className="border-l-2 pl-3 border-primary/50">
                    <div className="font-medium">{e.action}</div>
                    <div className="text-xs text-muted-foreground">{format(new Date(e.created_at), 'PP p')}</div>
                    {e.details && <pre className="text-xs text-muted-foreground mt-1">{JSON.stringify(e.details, null, 2)}</pre>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AdminLayout>
  );
}
