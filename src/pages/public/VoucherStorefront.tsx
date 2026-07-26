import { useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Loader2, Ticket, Store, ShieldCheck, Sparkles, Clock, Zap, LayoutGrid, List } from 'lucide-react';
import { toast } from 'sonner';

interface Category {
  id: string;
  name: string;
  description: string | null;
  validity_days: number;
  price: number;
  available: number;
  location_id: string;
}
interface Location {
  id: string;
  name: string;
}
interface Ad {
  id: string;
  title: string;
  description: string | null;
  image_url: string | null;
  link_url: string | null;
  cta_label: string | null;
}
interface Storefront {
  vendor: { id: string; name: string; slug: string; logo_url: string | null };
  template: { logo_url: string | null; background_color: string | null; background_image_url: string | null } | null;
  locations: Location[];
  categories: Category[];
  ads: Ad[];
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export default function VoucherStorefront() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<Storefront | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [buyCategory, setBuyCategory] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'list'>('card');
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      try {
        const url = `${SUPABASE_URL}/functions/v1/voucher-storefront?slug=${encodeURIComponent(slug)}`;
        const r = await fetch(url, {
          headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Failed to load');
        setData(j);
      } catch (e: any) {
        setError(e.message || 'Failed to load storefront');
      } finally {
        setLoading(false);
      }
    })();
  }, [slug]);

  const handleBuy = async () => {
    if (!buyCategory) return;
    if (!name.trim() || name.trim().length < 2) {
      toast.error('Please enter your full name');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error('Please enter a valid email');
      return;
    }
    const cleanPhone = phone.trim().replace(/\s+/g, '');
    if (!/^\+?[0-9]{7,15}$/.test(cleanPhone)) {
      toast.error('Please enter a valid phone number');
      return;
    }
    setSubmitting(true);
    try {
      const { data: res, error } = await supabase.functions.invoke('voucher-guest-initiate', {
        body: {
          categoryId: buyCategory.id,
          name: name.trim(),
          email,
          phone: cleanPhone,
          callbackUrl: `${window.location.origin}/v/${slug}/success?ref=__REF__`,
        },
      });
      if (error) throw error;
      if (!res?.authorization_url) throw new Error('No payment URL returned');
      window.location.href = res.authorization_url.replace('__REF__', res.reference);
    } catch (e: any) {
      toast.error(e.message || 'Could not start payment');
    } finally {
      setSubmitting(false);
    }
  };

  const bg = useMemo(() => {
    if (!data) return { backgroundColor: '#0F172A' } as any;
    return data.template?.background_image_url
      ? {
          backgroundImage: `linear-gradient(rgba(10,15,30,0.85),rgba(10,15,30,0.92)), url(${data.template.background_image_url})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundAttachment: 'fixed',
        }
      : {
          background: `radial-gradient(ellipse at top, ${
            data.template?.background_color || '#1e293b'
          } 0%, ${data.template?.background_color || '#0F172A'} 60%, #05070d 100%)`,
        };
  }, [data]);

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

  const logo = data.template?.logo_url || data.vendor.logo_url;
  const inStock = data.categories.filter(c => c.available > 0);
  const outStock = data.categories.filter(c => c.available === 0);

  return (
    <div className="min-h-screen text-white" style={bg}>
      <div className="max-w-5xl mx-auto p-4 md:p-8 space-y-8">
        {/* Hero */}
        <header className="relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md p-6 md:p-8">
          <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-primary/20 blur-3xl pointer-events-none" />
          <div className="absolute -bottom-24 -left-24 w-72 h-72 rounded-full bg-fuchsia-500/10 blur-3xl pointer-events-none" />
          <div className="relative flex flex-col md:flex-row md:items-center gap-5">
            {logo ? (
              <img src={logo} alt={data.vendor.name} className="w-20 h-20 rounded-2xl object-cover ring-2 ring-white/20 shadow-xl bg-white" />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-white/10 flex items-center justify-center">
                <Store className="w-9 h-9 opacity-70" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-70">
                <Sparkles className="w-3.5 h-3.5" /> Digital Voucher Store
              </div>
              <h1 className="text-3xl md:text-4xl font-bold mt-1">{data.vendor.name}</h1>
              <p className="text-sm opacity-80 mt-1">Instant delivery • Pay securely with card, bank or transfer</p>
            </div>
            <div className="flex flex-col gap-1 text-xs">
              <div className="flex items-center gap-1.5 opacity-90"><ShieldCheck className="w-4 h-4 text-emerald-300" /> Secure Paystack checkout</div>
              <div className="flex items-center gap-1.5 opacity-90"><Zap className="w-4 h-4 text-amber-300" /> Delivered on screen instantly</div>
              <div className="flex items-center gap-1.5 opacity-90"><Clock className="w-4 h-4 text-sky-300" /> No account needed</div>
            </div>
          </div>
        </header>

        {/* Ads slot */}
        {data.ads && data.ads.length > 0 && (
          <section aria-label="Sponsored" className="grid gap-3 md:grid-cols-3">
            {data.ads.map(ad => {
              const isImg = typeof ad.image_url === 'string' && /^https?:\/\//i.test(ad.image_url);
              return (
                <a
                  key={ad.id}
                  href={ad.link_url || '#'}
                  target={ad.link_url ? '_blank' : undefined}
                  rel="noreferrer"
                  className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition"
                >
                  {isImg ? (
                    <img src={ad.image_url as string} alt={ad.title} className="w-full h-28 object-cover opacity-80 group-hover:opacity-100 transition" />
                  ) : (
                    <div className="w-full h-28 bg-gradient-to-br from-primary/40 via-fuchsia-500/30 to-sky-500/30 flex items-center justify-center">
                      <Sparkles className="w-8 h-8 opacity-80" />
                    </div>
                  )}
                  <div className="p-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">Ad</Badge>
                      <p className="font-semibold text-sm truncate">{ad.title}</p>
                    </div>
                    {ad.description && <p className="text-xs opacity-70 mt-1 line-clamp-2">{ad.description}</p>}
                    {ad.cta_label && <p className="text-xs text-primary-foreground/90 mt-2 underline">{ad.cta_label}</p>}
                  </div>
                </a>
              );
            })}
          </section>
        )}

        {/* Categories */}
        {data.categories.length === 0 ? (
          <Card className="bg-white/5 border-white/10 text-white">
            <CardContent className="pt-6 text-center opacity-80">
              This vendor has no active voucher categories yet.
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm opacity-80">Choose a voucher</p>
              <div className="inline-flex rounded-lg bg-white/10 p-1 border border-white/10">
                <button
                  type="button"
                  onClick={() => setViewMode('card')}
                  className={`px-2.5 py-1 rounded-md text-xs flex items-center gap-1 ${viewMode === 'card' ? 'bg-white/20' : 'opacity-70 hover:opacity-100'}`}
                  aria-label="Card view"
                ><LayoutGrid className="w-3.5 h-3.5" /> Cards</button>
                <button
                  type="button"
                  onClick={() => setViewMode('list')}
                  className={`px-2.5 py-1 rounded-md text-xs flex items-center gap-1 ${viewMode === 'list' ? 'bg-white/20' : 'opacity-70 hover:opacity-100'}`}
                  aria-label="List view"
                ><List className="w-3.5 h-3.5" /> List</button>
              </div>
            </div>
            {viewMode === 'card' ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {inStock.map((c) => (
                  <VoucherCard key={c.id} c={c} onBuy={() => { setBuyCategory(c); setName(''); setEmail(''); setPhone(''); }} />
                ))}
              </div>
            ) : (
              <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/5 overflow-hidden">
                {inStock.map((c) => (
                  <VoucherRow key={c.id} c={c} onBuy={() => { setBuyCategory(c); setName(''); setEmail(''); setPhone(''); }} />
                ))}
              </div>
            )}
            {outStock.length > 0 && (
              <div className="pt-4">
                <p className="text-xs uppercase tracking-wider opacity-60 mb-2">Sold out</p>
                {viewMode === 'card' ? (
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 opacity-60">
                    {outStock.map((c) => <VoucherCard key={c.id} c={c} onBuy={() => {}} />)}
                  </div>
                ) : (
                  <div className="divide-y divide-white/10 rounded-xl border border-white/10 bg-white/5 overflow-hidden opacity-60">
                    {outStock.map((c) => <VoucherRow key={c.id} c={c} onBuy={() => {}} />)}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <footer className="text-center text-xs opacity-60 pt-8 pb-4">
          Powered by <span className="font-semibold">FastCalories Voucher Hub</span>
        </footer>
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
              <p className="text-xs text-muted-foreground mt-1">Valid for {buyCategory?.validity_days} days after purchase</p>
            </div>
            <div className="space-y-2">
              <Label>Full name</Label>
              <Input placeholder="John Doe" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Email address</Label>
              <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <p className="text-xs text-muted-foreground">Your voucher code and receipt will be sent here.</p>
            </div>
            <div className="space-y-2">
              <Label>Phone number</Label>
              <Input type="tel" placeholder="08012345678" value={phone} onChange={(e) => setPhone(e.target.value)} />
              <p className="text-xs text-muted-foreground">Used by the vendor for reconciliation and support.</p>
            </div>
            <Button className="w-full" onClick={handleBuy} disabled={submitting}>
              {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Pay ₦{(buyCategory?.price ?? 0).toLocaleString()} with Paystack
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function VoucherCard({ c, onBuy }: { c: Category; onBuy: () => void }) {
  return (
    <Card className="bg-white/10 border-white/20 backdrop-blur text-white overflow-hidden group hover:bg-white/15 transition">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Ticket className="w-5 h-5 text-amber-300" /> {c.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {c.description && <p className="text-sm opacity-80 line-clamp-2">{c.description}</p>}
        <div className="flex items-end justify-between">
          <div>
            <p className="text-2xl font-bold">₦{c.price.toLocaleString()}</p>
            <p className="text-xs opacity-70">Valid {c.validity_days} days</p>
          </div>
          <p className="text-xs opacity-70">
            {c.available > 0 ? `${c.available} in stock` : 'Sold out'}
          </p>
        </div>
        <Button className="w-full" disabled={c.available === 0} onClick={onBuy}>
          {c.available === 0 ? 'Sold out' : 'Buy now'}
        </Button>
      </CardContent>
    </Card>
  );
}

function VoucherRow({ c, onBuy }: { c: Category; onBuy: () => void }) {
  const sold = c.available === 0;
  return (
    <div className="flex items-center gap-3 p-3 hover:bg-white/5 transition">
      <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
        <Ticket className="w-5 h-5 text-amber-300" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-sm truncate">{c.name}</p>
        {c.description && <p className="text-xs opacity-70 truncate">{c.description}</p>}
        <p className="text-[11px] opacity-60 mt-0.5">Valid {c.validity_days} days • {sold ? 'Sold out' : `${c.available} in stock`}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-base font-bold">₦{c.price.toLocaleString()}</p>
        <Button size="sm" className="mt-1 h-7 px-3 text-xs" disabled={sold} onClick={onBuy}>
          {sold ? 'Sold out' : 'Buy'}
        </Button>
      </div>
    </div>
  );
}
