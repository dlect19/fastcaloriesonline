import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { VoucherPreview } from '@/components/vouchers/VoucherPreview';

export default function VoucherStorefrontSuccess() {
  const { slug } = useParams<{ slug: string }>();
  const [params] = useSearchParams();
  const reference = params.get('reference') || params.get('ref');
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading');

  useEffect(() => {
    if (!reference) { setStatus('failed'); return; }
    let cancelled = false;
    let attempts = 0;

    const projectRef = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID;
    const apiKey = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY || '';
    const url = `https://${projectRef}.functions.supabase.co/voucher-guest-lookup?ref=${encodeURIComponent(reference)}`;

    const poll = async () => {
      attempts += 1;
      try {
        const r = await fetch(url, { headers: { apikey: apiKey } });
        const j = await r.json();
        if (cancelled) return;
        if (!j.pending && j.order) {
          setData(j);
          setStatus('ready');
          return;
        }
      } catch { /* ignore */ }
      if (attempts >= 20) { setStatus('failed'); return; }
      setTimeout(poll, 1500);
    };
    poll();
    return () => { cancelled = true; };
  }, [reference]);

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-3">
            <Loader2 className="w-8 h-8 animate-spin mx-auto text-primary" />
            <p className="font-semibold">Confirming your payment…</p>
            <p className="text-sm text-muted-foreground">This usually takes a few seconds.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'failed' || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-3">
            <p className="font-semibold">We couldn't confirm your voucher yet.</p>
            <p className="text-sm text-muted-foreground">If you were charged, please refresh — the voucher will appear once payment is confirmed.</p>
            <Button onClick={() => window.location.reload()}>Refresh</Button>
            <Button variant="outline" onClick={() => navigate(`/v/${slug}`)}>Back to storefront</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-lg mx-auto space-y-4">
        <div className="text-center space-y-1">
          <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
          <h1 className="text-2xl font-bold">Voucher purchased</h1>
          <p className="text-sm text-muted-foreground">Screenshot or save the image below. A copy is tied to {data.order.guest_email}.</p>
        </div>
        <div className="flex justify-center">
          <VoucherPreview
            vendorName={data.vendor?.name || 'Vendor'}
            vendorLogoUrl={data.template?.logo_url || data.vendor?.logo_url}
            categoryName={data.category_name || 'Voucher'}
            code={data.code || ''}
            expiryDate={data.order.expiry_date}
            purchasedAt={data.order.purchased_at}
            backgroundColor={data.template?.background_color}
            backgroundImageUrl={data.template?.background_image_url}
            amount={Number(data.order.amount)}
          />
        </div>
        <Button variant="outline" className="w-full" onClick={() => navigate(`/v/${slug}`)}>
          Back to storefront
        </Button>
      </div>
    </div>
  );
}
