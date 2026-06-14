import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Loader2, CheckCircle2, Clock } from 'lucide-react';
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
      const { data, error } = await supabase.rpc('get_public_order_tracking', { _order_number: orderNumber });
      if (!error) setInfo((data || [])[0] || null);
      setLoading(false);
    })();
  }, [orderNumber, paymentQuery]);

  const currentIdx = info ? STEPS.findIndex((s) => s.key === info.status) : -1;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-xl mx-auto py-8">
        <div className="flex items-center gap-3 mb-6">
          <img src={fastCaloriesLogo} alt="Fast Calories" className="w-12 h-12" />
          <div>
            <h1 className="font-bold">Fast Calories</h1>
            <p className="text-xs text-muted-foreground">Order Tracking</p>
          </div>
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
                {info.rider_first_name && info.delivery_type === 'delivery' && (
                  <div className="text-sm text-muted-foreground">Rider: {info.rider_first_name}</div>
                )}
                {info.estimated_delivery_at && (
                  <div className="text-sm text-muted-foreground">Estimated: {format(new Date(info.estimated_delivery_at), 'p')}</div>
                )}
              </div>

              <ul className="space-y-3">
                {STEPS.map((s, idx) => {
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
