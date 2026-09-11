import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminLayout } from '@/components/admin/AdminLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Loader2, Search, UtensilsCrossed, Store } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { Switch } from '@/components/ui/switch';
import { AdminMenuProductCard } from '@/components/admin/AdminMenuProductCard';

interface CuisineCategory {
  id: string;
  name: string;
  parent_id: string | null;
  icon: string | null;
  sort_order: number;
}

export default function AdminVendorMenus() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [vendors, setVendors] = useState<any[]>([]);
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [outlets, setOutlets] = useState<any[]>([]);
  const [selectedOutletId, setSelectedOutletId] = useState<string>('');
  const [outletOverrides, setOutletOverrides] = useState<Record<string, boolean>>({});
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [loadingOutlets, setLoadingOutlets] = useState(false);
  const [cuisineCategories, setCuisineCategories] = useState<CuisineCategory[]>([]);

  useEffect(() => {
    checkAuthAndFetch();
  }, []);

  const checkAuthAndFetch = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { navigate('/admin/auth'); return; }

    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id);

    if (!roles?.some(r => r.role === 'admin')) { navigate('/admin/auth'); return; }

    const [{ data: vendorList }, { data: cuisineCats }] = await Promise.all([
      supabase
        .from('vendors')
        .select('id, name, category, is_active, is_verified')
        .eq('is_verified', true)
        .order('name'),
      supabase
        .from('cuisine_categories')
        .select('*')
        .order('sort_order', { ascending: true }),
    ]);

    setVendors(vendorList || []);
    setCuisineCategories((cuisineCats as CuisineCategory[]) || []);
    setLoading(false);
  };

  const handleVendorSelect = async (vendorId: string) => {
    setSelectedVendorId(vendorId);
    setSelectedOutletId('');
    setProducts([]);
    setCategories([]);
    setOutletOverrides({});
    setLoadingOutlets(true);

    const { data: outletList } = await supabase
      .from('vendor_outlets')
      .select('id, outlet_surname, outlet_name, is_active')
      .eq('vendor_id', vendorId)
      .order('outlet_name');

    setOutlets(outletList || []);
    setLoadingOutlets(false);

    // If no outlets, load global menu directly
    if (!outletList || outletList.length === 0) {
      fetchMenu(vendorId, '');
    }
  };

  const handleOutletSelect = async (outletId: string) => {
    setSelectedOutletId(outletId);
    fetchMenu(selectedVendorId, outletId);
  };

  const fetchMenu = async (vendorId: string, outletId: string) => {
    setLoadingProducts(true);
    setSelectedCategory('all');
    setAvailabilityFilter('all');

    const [{ data: prods }, { data: cats }] = await Promise.all([
      supabase
        .from('products')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('name', { ascending: true }),
      supabase
        .from('product_categories')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('name', { ascending: true }),
    ]);

    setProducts(prods || []);
    setCategories(cats || []);

    // Fetch outlet-specific overrides if an outlet is selected
    if (outletId) {
      const { data: overrides } = await supabase
        .from('outlet_product_overrides')
        .select('product_id, is_available')
        .eq('outlet_id', outletId);

      const overrideMap: Record<string, boolean> = {};
      (overrides || []).forEach((o: any) => {
        overrideMap[o.product_id] = o.is_available;
      });
      setOutletOverrides(overrideMap);
    } else {
      setOutletOverrides({});
    }

    setLoadingProducts(false);
  };

  // Effective availability — global is authoritative, a branch override can
  // only DISABLE an item (a legacy override=true never lifts global=false).
  const getEffectiveAvailability = (product: any) => {
    if (product.is_hidden) return false;
    if (!product.is_available) return false;
    if (selectedOutletId && outletOverrides[product.id] === false) return false;
    return true;
  };

  const toggleAvailability = async (productId: string, currentAvail: boolean) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;
    const turningOn = !currentAvail;

    try {
      if (!selectedOutletId) {
        // No branch selected — change global availability directly.
        const { data, error } = await supabase
          .from('products')
          .update({ is_available: turningOn })
          .eq('id', productId)
          .select('id, is_available')
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error('Update was rejected (no rows changed).');
        setProducts(prev => prev.map(p => p.id === productId ? { ...p, is_available: turningOn } : p));
      } else {
        // Branch change happens in ONE database transaction so the store-wide
        // switch and the branch block can never end up half-changed.
        const { data, error } = await supabase.rpc('admin_set_branch_product_availability', {
          _product_id: productId,
          _outlet_id: selectedOutletId,
          _available: turningOn,
        });
        if (error) throw error;
        const result = data as any;
        if (!result) throw new Error('The change was not confirmed.');

        // Only trust the confirmed state that came back.
        setProducts(prev => prev.map(p => p.id === productId
          ? { ...p, is_available: !!result.global_available, is_hidden: !!result.is_hidden }
          : p));
        setOutletOverrides(prev => {
          const next = { ...prev };
          if (result.branch_override === null || result.branch_override === undefined) {
            delete next[productId];
          } else {
            next[productId] = !!result.branch_override;
          }
          return next;
        });
      }

      toast({
        title: turningOn ? 'Item available' : 'Item unavailable',
        description: selectedOutletId
          ? (turningOn
            ? 'Enabled globally and at this branch.'
            : 'Disabled at this branch only.')
          : 'Global availability updated.',
      });
    } catch (e: any) {
      toast({
        title: 'Could not change availability',
        description: e?.message || 'The change was not saved. Please try again.',
        variant: 'destructive',
      });
    }
  };

  const assignCuisineCategory = async (productId: string, cuisineCategoryId: string | null) => {
    const updateValue = cuisineCategoryId === 'none' ? null : cuisineCategoryId;
    const { data, error } = await supabase
      .from('products')
      .update({ cuisine_category_id: updateValue })
      .eq('id', productId)
      .select('id, cuisine_category_id')
      .maybeSingle();
    if (error || !data) {
      toast({
        title: 'Could not update cuisine category',
        description: error?.message || 'The change was not saved. Please try again.',
        variant: 'destructive',
      });
      return;
    }
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, cuisine_category_id: updateValue } : p));
    toast({ title: 'Cuisine category updated' });
  };

  const productsWithEffectiveAvail = products.map(p => ({
    ...p,
    _effective_available: getEffectiveAvailability(p),
  }));

  const filtered = productsWithEffectiveAvail.filter(p => {
    const matchCat = selectedCategory === 'all' || p.category_id === selectedCategory;
    const matchSearch = !searchQuery || p.name?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchAvail = availabilityFilter === 'all' || 
      (availabilityFilter === 'available' && p._effective_available) || 
      (availabilityFilter === 'unavailable' && !p._effective_available);
    return matchCat && matchSearch && matchAvail;
  });

  const availableCount = productsWithEffectiveAvail.filter(p => p._effective_available).length;
  const unavailableCount = productsWithEffectiveAvail.filter(p => !p._effective_available).length;

  // Group cuisine categories: parents and their children
  const parentCategories = cuisineCategories.filter(c => !c.parent_id);
  const getSubCategories = (parentId: string) => cuisineCategories.filter(c => c.parent_id === parentId);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <AdminLayout>
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground">Vendor Menus</h1>
          <p className="text-muted-foreground">Browse and manage vendor menu items & cuisine categories</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <Select value={selectedVendorId} onValueChange={handleVendorSelect}>
            <SelectTrigger className="w-full sm:w-[300px]">
              <SelectValue placeholder="Select a vendor" />
            </SelectTrigger>
            <SelectContent>
              {vendors.map(v => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name} {!v.is_active && '(Inactive)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {selectedVendorId && outlets.length > 0 && (
            <Select value={selectedOutletId} onValueChange={handleOutletSelect}>
              <SelectTrigger className="w-full sm:w-[250px]">
                <Store className="w-4 h-4 mr-2 text-muted-foreground" />
                <SelectValue placeholder="Select an outlet/branch" />
              </SelectTrigger>
              <SelectContent>
                {outlets.map(o => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.outlet_surname || o.outlet_name || 'Main Branch'} {!o.is_active && '(Inactive)'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {selectedVendorId && (outlets.length === 0 || selectedOutletId) && (
            <>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map(c => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={availabilityFilter} onValueChange={setAvailabilityFilter}>
                <SelectTrigger className="w-full sm:w-[200px]">
                  <SelectValue placeholder="Availability" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All ({products.length})</SelectItem>
                  <SelectItem value="available">✅ Available ({availableCount})</SelectItem>
                  <SelectItem value="unavailable">❌ Unavailable ({unavailableCount})</SelectItem>
                </SelectContent>
              </Select>

              <div className="relative flex-1 max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search items..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>
            </>
          )}
        </div>

        {!selectedVendorId && (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <UtensilsCrossed className="w-12 h-12 mx-auto mb-4 opacity-40" />
              <p>Select a vendor above to view their menu</p>
            </CardContent>
          </Card>
        )}

        {selectedVendorId && outlets.length > 0 && !selectedOutletId && !loadingOutlets && (
          <Card>
            <CardContent className="py-16 text-center text-muted-foreground">
              <Store className="w-12 h-12 mx-auto mb-4 opacity-40" />
              <p>This vendor has {outlets.length} outlet(s). Select a branch to view its menu.</p>
            </CardContent>
          </Card>
        )}

        {loadingProducts && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary" />
          </div>
        )}

        {selectedVendorId && !loadingProducts && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Menu Items ({filtered.length})</span>
                <Badge variant="secondary">{products.length} total</Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {selectedOutletId
                  ? 'Branch availability: switching an item ON also turns it on for the whole store; switching it OFF only closes it at this branch.'
                  : 'Global availability: changes here apply to the store and every branch.'}
              </p>
            </CardHeader>
            <CardContent>
              {filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No menu items found</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map(product => (
                    <AdminMenuProductCard
                      key={product.id}
                      product={{ ...product, is_available: product._effective_available }}
                      scopeNote={
                        selectedOutletId
                          ? (outletOverrides[product.id] === false
                            ? 'Closed at this branch'
                            : (!product.is_available || product.is_hidden ? 'Off for the whole store' : 'On at this branch'))
                          : (product.is_hidden ? 'Hidden from customers' : undefined)
                      }
                      parentCategories={parentCategories}
                      getSubCategories={getSubCategories}
                      onToggleAvailability={(id, _current) => toggleAvailability(id, product._effective_available)}
                      onAssignCuisine={assignCuisineCategory}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
    </AdminLayout>
  );
}
