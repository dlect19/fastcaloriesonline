import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { AdminSidebar } from '@/components/admin/AdminSidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Loader2, Search, UtensilsCrossed } from 'lucide-react';
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
  const [products, setProducts] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [loadingProducts, setLoadingProducts] = useState(false);
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

  const fetchMenu = async (vendorId: string) => {
    setLoadingProducts(true);
    setSelectedVendorId(vendorId);
    setSelectedCategory('all');

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
    setLoadingProducts(false);
  };

  const toggleAvailability = async (productId: string, currentAvail: boolean) => {
    await supabase.from('products').update({ is_available: !currentAvail }).eq('id', productId);
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, is_available: !currentAvail } : p));
    toast({ title: `Item ${!currentAvail ? 'enabled' : 'disabled'}` });
  };

  const assignCuisineCategory = async (productId: string, cuisineCategoryId: string | null) => {
    const updateValue = cuisineCategoryId === 'none' ? null : cuisineCategoryId;
    await supabase.from('products').update({ cuisine_category_id: updateValue }).eq('id', productId);
    setProducts(prev => prev.map(p => p.id === productId ? { ...p, cuisine_category_id: updateValue } : p));
    toast({ title: 'Cuisine category updated' });
  };

  const filtered = products.filter(p => {
    const matchCat = selectedCategory === 'all' || p.category_id === selectedCategory;
    const matchSearch = !searchQuery || p.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

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
    <div className="min-h-screen bg-background flex">
      <AdminSidebar />
      <main className="flex-1 p-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-foreground">Vendor Menus</h1>
          <p className="text-muted-foreground">Browse and manage vendor menu items & cuisine categories</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 mb-6">
          <Select value={selectedVendorId} onValueChange={fetchMenu}>
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

          {selectedVendorId && (
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
            </CardHeader>
            <CardContent>
              {filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">No menu items found</p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map(product => (
                    <AdminMenuProductCard
                      key={product.id}
                      product={product}
                      parentCategories={parentCategories}
                      getSubCategories={getSubCategories}
                      onToggleAvailability={toggleAvailability}
                      onAssignCuisine={assignCuisineCategory}
                    />
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
