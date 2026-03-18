import { useState, useEffect, useCallback } from 'react';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Gift, UtensilsCrossed, Loader2, Store, Pencil, Eye, EyeOff } from 'lucide-react';

interface Vendor {
  id: string;
  name: string;
}

interface Product {
  id: string;
  name: string;
  price: number;
  image_url: string | null;
  vendor_id: string;
}

interface FreeMealPromo {
  id: string;
  vendor_id: string;
  product_id: string;
  product_name: string;
  product_image_url: string | null;
  vendor_name: string;
  meal_value: number;
  order_threshold: number;
  promo_period_days: number;
  max_redemptions_per_period: number;
  is_active: boolean;
  show_in_carousel: boolean;
  banner_text: string | null;
  created_at: string;
}

export default function AdminFreeMeals() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [promos, setPromos] = useState<FreeMealPromo[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingPromo, setEditingPromo] = useState<FreeMealPromo | null>(null);

  // Form state
  const [selectedVendor, setSelectedVendor] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [mealValue, setMealValue] = useState('');
  const [orderThreshold, setOrderThreshold] = useState('');
  const [periodDays, setPeriodDays] = useState('7');
  const [maxRedemptions, setMaxRedemptions] = useState('1');
  const [bannerText, setBannerText] = useState('You have a free meal today!');
  const [showInCarousel, setShowInCarousel] = useState(true);

  const fetchPromos = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('free_meal_promos')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) setPromos(data as FreeMealPromo[]);
    setLoading(false);
  }, []);

  const fetchVendors = useCallback(async () => {
    const { data } = await supabase
      .from('vendors')
      .select('id, name')
      .eq('is_active', true)
      .order('name');
    if (data) setVendors(data);
  }, []);

  const fetchProducts = useCallback(async (vendorId: string) => {
    const { data } = await supabase
      .from('products')
      .select('id, name, price, image_url, vendor_id')
      .eq('vendor_id', vendorId)
      .eq('is_available', true)
      .order('name');
    if (data) setProducts(data);
  }, []);

  useEffect(() => {
    fetchPromos();
    fetchVendors();
  }, [fetchPromos, fetchVendors]);

  useEffect(() => {
    if (selectedVendor) {
      fetchProducts(selectedVendor);
      if (!editingPromo) setSelectedProduct('');
    }
  }, [selectedVendor, fetchProducts]);

  // Auto-fill meal value from product price (only when creating)
  useEffect(() => {
    if (selectedProduct && !editingPromo) {
      const product = products.find(p => p.id === selectedProduct);
      if (product) {
        setMealValue(String(product.price));
      }
    }
  }, [selectedProduct, products]);

  const openEditDialog = (promo: FreeMealPromo) => {
    setEditingPromo(promo);
    setSelectedVendor(promo.vendor_id);
    setSelectedProduct(promo.product_id);
    setMealValue(String(promo.meal_value));
    setOrderThreshold(String(promo.order_threshold));
    setPeriodDays(String(promo.promo_period_days));
    setMaxRedemptions(String(promo.max_redemptions_per_period));
    setBannerText(promo.banner_text || '');
    setShowInCarousel(promo.show_in_carousel ?? true);
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!selectedVendor || !selectedProduct || !mealValue || !orderThreshold || !user) return;

    const vendor = vendors.find(v => v.id === selectedVendor);
    const product = products.find(p => p.id === selectedProduct);
    if (!vendor || !product) return;

    setSaving(true);

    const payload = {
      vendor_id: selectedVendor,
      product_id: selectedProduct,
      product_name: product.name,
      product_image_url: product.image_url,
      vendor_name: vendor.name,
      meal_value: parseFloat(mealValue),
      order_threshold: parseFloat(orderThreshold),
      promo_period_days: parseInt(periodDays),
      max_redemptions_per_period: parseInt(maxRedemptions),
      banner_text: bannerText || null,
      show_in_carousel: showInCarousel,
      updated_at: new Date().toISOString(),
    };

    let error;
    if (editingPromo) {
      ({ error } = await supabase.from('free_meal_promos').update(payload).eq('id', editingPromo.id));
    } else {
      ({ error } = await supabase.from('free_meal_promos').insert({ ...payload, created_by: user.id }));
    }

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: editingPromo ? 'Promo updated!' : 'Free meal promo created!' });
      setShowDialog(false);
      resetForm();
      fetchPromos();
    }
    setSaving(false);
  };

  const toggleActive = async (id: string, current: boolean) => {
    await supabase.from('free_meal_promos').update({ is_active: !current, updated_at: new Date().toISOString() }).eq('id', id);
    fetchPromos();
  };

  const toggleCarousel = async (id: string, current: boolean) => {
    await supabase.from('free_meal_promos').update({ show_in_carousel: !current, updated_at: new Date().toISOString() }).eq('id', id);
    fetchPromos();
  };

  const deletePromo = async (id: string) => {
    if (!confirm('Delete this promo? This cannot be undone.')) return;
    await supabase.from('free_meal_promos').delete().eq('id', id);
    toast({ title: 'Promo deleted' });
    fetchPromos();
  };

  const resetForm = () => {
    setEditingPromo(null);
    setSelectedVendor('');
    setSelectedProduct('');
    setMealValue('');
    setOrderThreshold('');
    setPeriodDays('7');
    setMaxRedemptions('1');
    setBannerText('You have a free meal today!');
    setShowInCarousel(true);
  };

  return (
    <AdminLayout>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Gift className="w-6 h-6 text-green-600" />
            Free Meal Promos
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Set up free meals from vendor menus for customers to earn
          </p>
        </div>
        <Button onClick={() => { resetForm(); setShowDialog(true); }}>
          <Plus className="w-4 h-4 mr-2" />
          Add Free Meal
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      ) : promos.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <UtensilsCrossed className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="font-medium">No free meal promos yet</p>
            <p className="text-sm text-muted-foreground mt-1">Create one to start attracting customers!</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {promos.map(promo => (
            <Card key={promo.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex gap-3 p-4">
                  {promo.product_image_url ? (
                    <img src={promo.product_image_url} alt={promo.product_name} className="w-16 h-16 rounded-lg object-cover shrink-0" />
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                      <UtensilsCrossed className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <h3 className="font-semibold text-sm truncate">{promo.product_name}</h3>
                      <Switch checked={promo.is_active} onCheckedChange={() => toggleActive(promo.id, promo.is_active)} />
                    </div>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <Store className="w-3 h-3" /> {promo.vendor_name}
                    </p>
                    <div className="flex gap-2 mt-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">₦{promo.meal_value.toLocaleString()} value</Badge>
                      <Badge variant="outline" className="text-xs">₦{promo.order_threshold.toLocaleString()} threshold</Badge>
                      <Badge variant="outline" className="text-xs">{promo.promo_period_days}d period</Badge>
                    </div>
                    <div className="mt-2">
                      <button
                        onClick={() => toggleCarousel(promo.id, promo.show_in_carousel)}
                        className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full transition-colors ${
                          promo.show_in_carousel
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : 'bg-muted text-muted-foreground'
                        }`}
                      >
                        {promo.show_in_carousel ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                        {promo.show_in_carousel ? 'In carousel' : 'Hidden from carousel'}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="border-t px-4 py-2 flex justify-between">
                  <Button variant="ghost" size="sm" onClick={() => openEditDialog(promo)}>
                    <Pencil className="w-4 h-4 mr-1" /> Edit
                  </Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => deletePromo(promo.id)}>
                    <Trash2 className="w-4 h-4 mr-1" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={showDialog} onOpenChange={(open) => { if (!open) resetForm(); setShowDialog(open); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="w-5 h-5 text-green-600" />
              {editingPromo ? 'Edit Free Meal Promo' : 'Create Free Meal Promo'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div>
              <Label>Vendor</Label>
              <Select value={selectedVendor} onValueChange={setSelectedVendor}>
                <SelectTrigger><SelectValue placeholder="Select vendor" /></SelectTrigger>
                <SelectContent>
                  {vendors.map(v => (
                    <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedVendor && (
              <div>
                <Label>Product (Free Meal)</Label>
                <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                  <SelectTrigger><SelectValue placeholder="Select product from menu" /></SelectTrigger>
                  <SelectContent>
                    {products.map(p => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} — ₦{p.price.toLocaleString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div>
              <Label>Meal Value (₦)</Label>
              <Input type="number" value={mealValue} onChange={e => setMealValue(e.target.value)} placeholder="e.g. 1500, 2500, 3500" />
              <p className="text-xs text-muted-foreground mt-1">Platform pays vendor this amount when redeemed</p>
            </div>

            <div>
              <Label>Order Threshold (₦)</Label>
              <Input type="number" value={orderThreshold} onChange={e => setOrderThreshold(e.target.value)} placeholder="Minimum single order amount" />
              <p className="text-xs text-muted-foreground mt-1">Customer must place a single order worth at least this amount</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Period (days)</Label>
                <Input type="number" value={periodDays} onChange={e => setPeriodDays(e.target.value)} />
              </div>
              <div>
                <Label>Max Redemptions</Label>
                <Input type="number" value={maxRedemptions} onChange={e => setMaxRedemptions(e.target.value)} />
              </div>
            </div>

            <div>
              <Label>Banner Text</Label>
              <Input value={bannerText} onChange={e => setBannerText(e.target.value)} placeholder="Flash announcement text" />
            </div>

            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <Label className="text-sm font-medium">Show in Popular Picks carousel</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Display this promo in Trending Now / You Might Like</p>
              </div>
              <Switch checked={showInCarousel} onCheckedChange={setShowInCarousel} />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => { resetForm(); setShowDialog(false); }}>Cancel</Button>
            <Button
              onClick={handleSave}
              disabled={!selectedVendor || !selectedProduct || !mealValue || !orderThreshold || saving}
              className="bg-green-600 hover:bg-green-700"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : editingPromo ? <Pencil className="w-4 h-4 mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
              {editingPromo ? 'Save Changes' : 'Create Promo'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminLayout>
  );
}
