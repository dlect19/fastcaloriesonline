import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, CheckCircle2, Clock, Wifi } from 'lucide-react';
import { format } from 'date-fns';
import fastCaloriesLogo from '@/assets/fast-calories-logo.png';

const STEPS = [
  { key: 'pending',          label: 'Order Received' },
  { key: 'confirmed',        label: 'Vendor Accepted' },
  { key: 'preparing',        label: 'Preparing' },
  { key: 'ready_for_pickup', label: 'Ready for Pickup' },
  { key: 'picked_up',        label: 'Rider Picked Up' },
  { key: 'on_the_way',       label: 'On the way' },
  { key: 'delivered',        label: 'Delivered' },
];

export default function Track() {
  const { orderNumber } = useParams<{ orderNumber: string }>();
  const [searchParams] = useSearchParams();
  const paymentQuery = searchParams.toString();
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState<any>(null);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [live, setLive] = useState(false);


  const refetch = async () => {
    if (!orderNumber) return;
    const isToken = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(orderNumber);
    const { data, error } = isToken
      ? await supabase.rpc('get_secure_order_tracking', { p_token: orderNumber })
      : await supabase.rpc('get_public_order_tracking', { _order_number: orderNumber });
    setInfo(error ? null : isToken ? data : (data || [])[0] || null);
  };

  useEffect(() => {
    (async () => {
      if (!orderNumber) return;
      const currentParams = new URLSearchParams(paymentQuery);
      const paymentRef = currentParams.get('reference') || currentParams.get('trxref');
      if (paymentRef) {
        setVerifyingPayment(true);
        await supabase.functions.invoke('paystack-verify-payment', { body: { reference: paymentRef } }).catch(console.error);
        setVerifyingPayment(false);
      }
      await refetch();
      setLoading(false);
    })();
  }, [orderNumber, paymentQuery]);

  // Poll only the scoped read-only projection; never subscribe to private order/rider rows.
  useEffect(() => {
    const poll = setInterval(refetch, 20000);
    return () => clearInterval(poll);
  }, [orderNumber]);
  const steps = info?.delivery_type === 'delivery' ? STEPS : STEPS.filter(s => !['picked_up', 'on_the_way'].includes(s.key));

  const currentIdx = info ? steps.findIndex((s) => s.key === info.status) : -1;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-xl mx-auto py-8">
        <div className="flex items-center gap-3 mb-6">
          <img src={fastCaloriesLogo} alt="Fast Calories" className="w-12 h-12" />
          <div className="flex-1">
            <h1 className="font-bold">Fast Calories</h1>
            <p className="text-xs text-muted-foreground">Order Tracking</p>
          </div>
          {live && (
            <span className="text-xs text-green-600 flex items-center gap-1"><Wifi className="w-3 h-3" /> Live</span>
          )}
        </div>

        {loading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-6 h-6 animate-spin" /></div>
        ) : !info ? (
          <Card><CardContent className="p-6 text-center text-muted-foreground">Order not found.</CardContent></Card>
        ) : info.status === 'cancelled' ? (
          <Card><CardContent className="p-6 text-center text-destructive">This order was cancelled.</CardContent></Card>
        ) : (
          <Card>
            <CardContent className="p-6 space-y-6">
              <div>
                <div className="text-xs text-muted-foreground">Order</div>
                <div className="font-mono font-bold">{info.order_number}</div>
                {verifyingPayment && <div className="text-xs text-primary pt-1">Confirming payment…</div>}
                <div className="text-sm pt-2">From <strong>{info.vendor_name}</strong></div>
                {(info.rider?.first_name || info.rider_first_name) && info.delivery_type === 'delivery' && (
                  <div className="text-sm text-muted-foreground">Rider: {info.rider?.first_name || info.rider_first_name}</div>
                )}
                <div className="text-sm">Status: {String(info.status).replace(/_/g, ' ')} · {info.delivery_type}</div>
                <div className="text-xs text-muted-foreground">Status refreshes every 20 seconds.</div>
                {info.delivery_type === 'delivery' && info.location && (
                  <a className="text-sm text-primary underline" target="_blank" rel="noreferrer" href={`https://www.google.com/maps?q=${info.location.latitude},${info.location.longitude}`}>
                    View latest rider location ({format(new Date(info.location.updated_at), 'p')})
                  </a>
                )}
                {info.estimated_delivery_at && (
                  <div className="text-sm text-muted-foreground">Estimated: {format(new Date(info.estimated_delivery_at), 'p')}</div>
                )}
              </div>

              <ul className="space-y-3">
                {steps.map((s, idx) => {
                  const done = idx <= currentIdx;
                  const active = idx === currentIdx;
                  return (
                    <li key={s.key} className="flex items-center gap-3">
                      {done ? (
                        <CheckCircle2 className={`w-5 h-5 ${active ? 'text-primary animate-pulse' : 'text-green-600'}`} />
                      ) : (
                        <Clock className="w-5 h-5 text-muted-foreground/40" />
                      )}
                      <span className={done ? 'font-medium' : 'text-muted-foreground'}>{s.label}</span>
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
