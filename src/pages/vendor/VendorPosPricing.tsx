import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { VendorLayout } from '@/components/vendor/VendorLayout';
import { useOutletContext } from '@/hooks/useOutletContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ArrowLeft, Save, Search, Store, Tag, RefreshCw, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { computePosPrice, type PosPricingMode, POS_PRICING_MODE_LABELS } from '@/lib/posPricing';

interface ProductRow {
  id: string;
  name: string;
  price: number;
  discount_price: number | null;
  in_store_price: number | null;
  outlet_in_store_price: number | null;
  outlet_id: string | null;
}

export default function VendorPosPricing() {
  const navigate = useNavigate();
  const { selectedOutlet } = useOutletContext();
  const outletId = selectedOutlet?.id ?? null;
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [search, setSearch] = useState('');
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [mode, setMode] = useState<PosPricingMode>('same');
  const [globalPct, setGlobalPct] = useState<string>('0');
  const [savingMode, setSavingMode] = useState(false);

  // Resolve vendor id (owner or staff)
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: v } = await supabase.from('vendors').select('id').eq('user_id', user.id).maybeSingle();
      if (v) { setVendorId(v.id); return; }
      const { data: s } = await supabase.from('vendor_staff').select('vendor_id').eq('user_id', user.id).eq('is_active', true).maybeSingle();
      if (s) setVendorId(s.vendor_id);
    })();
  }, []);

  const fetchData = useCallback(async () => {
    if (!vendorId) return;
    setLoading(true);
    setEdited({});
    const [prodRes, outletRes, overridesRes] = await Promise.all([
      supabase
        .from('products')
        .select('id, name, price, discount_price, in_store_price, outlet_id')
        .eq('vendor_id', vendorId)
        .order('name', { ascending: true }),
      outletId
        ? supabase.from('vendor_outlets').select('pos_pricing_mode, pos_global_discount_pct').eq('id', outletId).maybeSingle()
        : Promise.resolve({ data: null } as any),
      outletId
        ? supabase.from('outlet_product_overrides').select('product_id, in_store_price').eq('outlet_id', outletId)
        : Promise.resolve({ data: null } as any),
    ]);
    const overrideMap: Record<string, number | null> = {};
    ((overridesRes?.data as any[]) || []).forEach((o: any) => {
      overrideMap[o.product_id] = o.in_store_price != null ? Number(o.in_store_price) : null;
    });
    const rows: ProductRow[] = ((prodRes.data as any[]) || [])
      .filter((p) => !outletId || !p.outlet_id || p.outlet_id === outletId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        price: Number(p.price),
        discount_price: p.discount_price != null ? Number(p.discount_price) : null,
        in_store_price: p.in_store_price != null ? Number(p.in_store_price) : null,
        outlet_in_store_price: overrideMap[p.id] ?? null,
        outlet_id: p.outlet_id ?? null,
      }));
    setProducts(rows);
    if (outletRes?.data) {
      setMode(((outletRes.data as any).pos_pricing_mode as PosPricingMode) || 'same');
      setGlobalPct(String((outletRes.data as any).pos_global_discount_pct ?? 0));
    } else {
      setMode('same');
      setGlobalPct('0');
    }
    setLoading(false);
  }, [vendorId, outletId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, search]);

  const handleSaveMode = async () => {
    if (!outletId) {
      toast({ title: 'Select an outlet first', description: 'Pricing mode is configured per outlet/branch.', variant: 'destructive' });
      return;
    }
    setSavingMode(true);
    const pct = Math.max(0, Math.min(100, Number(globalPct) || 0));
    const { error } = await supabase
      .from('vendor_outlets')
      .update({ pos_pricing_mode: mode, pos_global_discount_pct: pct })
      .eq('id', outletId);
    setSavingMode(false);
    if (error) {
      toast({ title: 'Could not save', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Pricing mode saved', description: `POS will use: ${POS_PRICING_MODE_LABELS[mode]}` });
  };

  const handleSavePrices = async () => {
    if (!vendorId) return;
    const entries = Object.entries(edited).filter(([, v]) => v !== undefined);
    if (entries.length === 0) {
      toast({ title: 'No changes to save' });
      return;
    }
    setSaving(true);
    try {
      if (outletId) {
        // Persist per-outlet overrides
        const upserts = entries.map(([productId, val]) => ({
          outlet_id: outletId,
          product_id: productId,
          in_store_price: val.trim() === '' ? null : Number(val),
        }));
        const { error } = await supabase
          .from('outlet_product_overrides')
          .upsert(upserts, { onConflict: 'outlet_id,product_id' });
        if (error) throw error;
      } else {
        // Vendor-wide updates
        for (const [productId, val] of entries) {
          const value = val.trim() === '' ? null : Number(val);
          const { error } = await supabase
            .from('products')
            .update({ in_store_price: value })
            .eq('id', productId)
            .eq('vendor_id', vendorId);
          if (error) throw error;
        }
      }
      toast({ title: `Saved ${entries.length} item${entries.length === 1 ? '' : 's'}` });
      setEdited({});
      await fetchData();
    } catch (e: any) {
      toast({ title: 'Save failed', description: e.message ?? 'Try again', variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const getCurrentInStoreValue = (p: ProductRow) => {
    if (edited[p.id] !== undefined) return edited[p.id];
    const v = outletId ? p.outlet_in_store_price : p.in_store_price;
    return v != null ? String(v) : '';
  };

  const previewPosPrice = (p: ProductRow): number => {
    const overrideRaw = edited[p.id];
    const outletOverride =
      overrideRaw !== undefined
        ? overrideRaw.trim() === ''
          ? null
          : Number(overrideRaw)
        : outletId
          ? p.outlet_in_store_price
          : null;
    return computePosPrice(
      {
        price: p.price,
        discount_price: p.discount_price,
        in_store_price: p.in_store_price,
        outlet_in_store_price: outletOverride,
      },
      { pos_pricing_mode: mode, pos_global_discount_pct: Number(globalPct) || 0 },
    );
  };

  const editedCount = Object.keys(edited).length;

  return (
    <VendorLayout>
      <div className="max-w-5xl mx-auto p-4 space-y-4">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/vendor/pos')}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Tag className="w-6 h-6 text-primary" /> In-Store (POS) Pricing
            </h1>
            <p className="text-sm text-muted-foreground">
              Set how the POS prices items vs. your online menu.
              {outletId ? ` Editing for: ${selectedOutlet?.outlet_surname || selectedOutlet?.outlet_name || 'outlet'}` : ' Editing vendor-wide defaults.'}
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={fetchData} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        {/* Pricing mode card (per-outlet) */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Store className="w-4 h-4 text-primary" /> Pricing mode for this outlet
            </CardTitle>
            <CardDescription>
              Choose how the POS computes the counter price for items.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!outletId && (
              <div className="rounded-md border border-amber-300/40 bg-amber-50 dark:bg-amber-900/20 p-3 text-xs text-amber-900 dark:text-amber-200">
                Select an outlet/branch from the outlet switcher to set its pricing mode. You can still edit vendor-wide in-store prices below.
              </div>
            )}
            <div className="grid sm:grid-cols-3 gap-3">
              {(['same', 'global_discount', 'per_item'] as PosPricingMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={!outletId}
                  onClick={() => setMode(m)}
                  className={`text-left rounded-lg border-2 p-3 transition-all ${
                    mode === m && outletId
                      ? 'border-primary bg-primary/5 shadow-card'
                      : 'border-border hover:border-primary/50'
                  } ${!outletId ? 'opacity-50 cursor-not-allowed' : 'active:scale-[0.98]'}`}
                >
                  <p className="text-sm font-semibold">{POS_PRICING_MODE_LABELS[m]}</p>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {m === 'same' && 'POS uses the exact online price.'}
                    {m === 'global_discount' && 'Apply one % off all online prices in POS.'}
                    {m === 'per_item' && 'Use the in-store price set on each item below.'}
                  </p>
                </button>
              ))}
            </div>

            {mode === 'global_discount' && outletId && (
              <div className="flex items-end gap-3">
                <div className="space-y-1.5 flex-1 max-w-[180px]">
                  <Label htmlFor="pct" className="text-xs">Global discount %</Label>
                  <Input
                    id="pct"
                    type="number"
                    min={0}
                    max={100}
                    step="0.5"
                    value={globalPct}
                    onChange={(e) => setGlobalPct(e.target.value)}
                  />
                </div>
                <p className="text-xs text-muted-foreground pb-2">
                  e.g. <strong>15</strong> means POS prices are 15% lower than online.
                </p>
              </div>
            )}

            <Button onClick={handleSaveMode} disabled={!outletId || savingMode} size="sm">
              {savingMode ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
              Save pricing mode
            </Button>
          </CardContent>
        </Card>

        {/* Per-item prices */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Tag className="w-4 h-4 text-primary" />
              {outletId ? 'Per-outlet in-store prices' : 'Vendor-wide in-store prices'}
            </CardTitle>
            <CardDescription>
              {outletId
                ? 'These overrides only apply to the selected outlet. Leave blank to fall back to the vendor-wide in-store price (or online price).'
                : 'These prices apply at every outlet unless overridden per outlet. Leave blank to use the online price in POS.'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9"
                />
              </div>
              <Badge variant="secondary">{filtered.length} item{filtered.length === 1 ? '' : 's'}</Badge>
              {editedCount > 0 && (
                <Badge>{editedCount} unsaved</Badge>
              )}
              <Button onClick={handleSavePrices} disabled={saving || editedCount === 0} size="sm">
                {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Save className="w-4 h-4 mr-1.5" />}
                Save changes
              </Button>
            </div>

            {loading ? (
              <div className="py-12 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="py-12 text-center text-muted-foreground text-sm">No items match your search.</p>
            ) : (
              <ScrollArea className="max-h-[60vh]">
                <div className="rounded-md border divide-y">
                  <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-muted/40 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <div className="col-span-5">Item</div>
                    <div className="col-span-2 text-right">Online</div>
                    <div className="col-span-3">In-Store ₦</div>
                    <div className="col-span-2 text-right">POS preview</div>
                  </div>
                  {filtered.map((p) => {
                    const onlinePrice = p.discount_price && p.discount_price < p.price ? p.discount_price : p.price;
                    const value = getCurrentInStoreValue(p);
                    const preview = previewPosPrice(p);
                    const isEdited = edited[p.id] !== undefined;
                    return (
                      <div key={p.id} className="grid grid-cols-12 gap-2 px-3 py-2 items-center">
                        <div className="col-span-5 min-w-0">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          {outletId && p.in_store_price != null && (
                            <p className="text-[10px] text-muted-foreground">
                              vendor-wide: ₦{p.in_store_price.toLocaleString()}
                            </p>
                          )}
                        </div>
                        <div className="col-span-2 text-right text-sm tabular-nums">
                          ₦{onlinePrice.toLocaleString()}
                        </div>
                        <div className="col-span-3">
                          <Input
                            type="number"
                            min={0}
                            value={value}
                            onChange={(e) => setEdited((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            placeholder="—"
                            className={`h-8 text-sm ${isEdited ? 'border-primary' : ''}`}
                          />
                        </div>
                        <div className="col-span-2 text-right">
                          <span className={`text-sm font-bold tabular-nums ${preview !== onlinePrice ? 'text-primary' : 'text-foreground'}`}>
                            ₦{preview.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </VendorLayout>
  );
}
