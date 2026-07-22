import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, Ticket, Store, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

interface Category {
  id: string;
  name: string;
  description: string | null;
  validity_days: number;
  price: number;
  available: number;
}
interface Storefront {
  vendor: { id: string; name: string; slug: string; logo_url: string | null };
  template: any;
  categories: Category[];
}

export default function VoucherStorefront() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Storefront | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyCategory, setBuyCategory] = useState<Category | null>(null);
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const { data: res, error } = await supabase.functions.invoke('voucher-storefront', {
          method: 'GET' as any,
          body: undefined,
        });
        // functions.invoke doesn't send query params — fall back to fetch
        if (error) throw error;
        setData(res);
      } catch {
        // Fallback direct GET
        try {
          const projectRef = (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID;
          const url = `https://${projectRef}.functions.supabase.co/voucher-storefront?slug=${encodeURIComponent(slug)}`;
          const r = await fetch(url, { headers: { apikey: (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY || '' } });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'Failed to load');
          setData(j);
        } catch (e: any) {
          setError(e.message || 'Failed to load storefront');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const handleBuy = async () => {
    if (!buyCategory) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Please enter a valid email');
      return;
    }
    setSubmitting(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('voucher-guest-initiate', {
        body: {
          categoryId: buyCategory.id,
          email,
          callbackUrl: `${window.location.origin}/v/${slug}/success?ref=__REF__`,
        },
      });
      if (error) throw error;
      if (!res?.authorization_url) throw new Error('No payment URL returned');
      // Paystack will replace ref via its own reference on redirect; we also embed our reference
      window.location.href = res.authorization_url.replace('__REF__', res.reference);
    } catch (e: any) {
      toast.error(e.message || 'Could not start payment');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center space-y-3">
            <Store className="w-12 h-12 mx-auto text-muted-foreground" />
            <p className="font-semibold">Storefront not found</p>
            <p className="text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" onClick={() => navigate('/')}>Go home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const bg = data.template?.background_image_url
    ? { backgroundImage: `linear-gradient(rgba(0,0,0,0.7),rgba(0,0,0,0.85)), url(${data.template.background_image_url})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { backgroundColor: data.template?.background_color || '#0F172A' };

  return (
    <div className="min-h-screen text-white" style={bg as any}>
      <div className="max-w-3xl mx-auto p-6 space-y-6">
        <header className="flex items-center gap-4 pt-6">
          {(data.template?.logo_url || data.vendor.logo_url) && (
            <img src={data.template?.logo_url || data.vendor.logo_url!} alt={data.vendor.name} className="w-16 h-16 rounded-xl object-cover" />
          )}
          <div>
            <h1 className="text-2xl font-bold">{data.vendor.name}</h1>
            <p className="text-sm opacity-75">Voucher Storefront</p>
          </div>
        </header>

        <div className="flex items-center gap-2 text-xs opacity-75">
          <ShieldCheck className="w-4 h-4" /> Secure Paystack checkout — no account required
        </div>

        {data.categories.length === 0 ? (
          <Card className="bg-white/5 border-white/10 text-white">
            <CardContent className="pt-6 text-center opacity-80">No vouchers available right now.</CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            {data.categories.map((c) => (
              <Card key={c.id} className="bg-white/10 border-white/20 backdrop-blur text-white">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Ticket className="w-5 h-5" /> {c.name}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {c.description && <p className="text-sm opacity-80 line-clamp-2">{c.description}</p>}
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-bold">₦{c.price.toLocaleString()}</p>
                      <p className="text-xs opacity-70">Valid for {c.validity_days} days</p>
                    </div>
                    <p className="text-xs opacity-70">
                      {c.available > 0 ? `${c.available} left` : 'Sold out'}
                    </p>
                  </div>
                  <Button
                    className="w-full"
                    disabled={c.available === 0}
                    onClick={() => { setBuyCategory(c); setEmail(''); }}
                  >
                    {c.available === 0 ? 'Sold out' : 'Buy now'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <p className="text-center text-xs opacity-60 pt-8">Powered by FastCalories Voucher Hub</p>
      </div>

      <Dialog open={!!buyCategory} onOpenChange={(o) => !o && setBuyCategory(null)}>
        <DialogContent className="text-foreground">
          <DialogHeader>
            <DialogTitle>Buy {buyCategory?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-muted p-3">
              <p className="text-sm text-muted-foreground">Amount</p>
              <p className="text-2xl font-bold">₦{(buyCategory?.price ?? 0).toLocaleString()}</p>
            </div>
            <div className="space-y-2">
              <Label>Delivery email</Label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">We'll show your voucher on screen and use this for your records.</p>
            </div>
            <Button className="w-full" onClick={handleBuy} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Pay with Paystack
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
