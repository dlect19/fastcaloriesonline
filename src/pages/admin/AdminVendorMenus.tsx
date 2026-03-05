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

    const { data: vendorList } = await supabase
      .from('vendors')
      .select('id, name, category, is_active, is_verified')
      .eq('is_verified', true)
      .order('name');

    setVendors(vendorList || []);
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
        .order('sort_order', { ascending: true }),
      supabase
        .from('product_categories')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('sort_order', { ascending: true }),
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

  const filtered = products.filter(p => {
    const matchCat = selectedCategory === 'all' || p.category_id === selectedCategory;
    const matchSearch = !searchQuery || p.name?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchCat && matchSearch;
  });

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
          <p className="text-muted-foreground">Browse and manage vendor menu items</p>
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
                    <div key={product.id} className="border rounded-lg p-4 flex gap-3">
                      {product.image_url ? (
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="w-16 h-16 rounded-lg object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-secondary flex items-center justify-center shrink-0">
                          <UtensilsCrossed className="w-6 h-6 text-muted-foreground" />
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="font-medium text-sm truncate">{product.name}</h3>
                          <Switch
                            checked={product.is_available}
                            onCheckedChange={() => toggleAvailability(product.id, product.is_available)}
                          />
                        </div>
                        <p className="text-sm font-semibold text-primary mt-1">
                          ₦{Number(product.price).toLocaleString()}
                        </p>
                        {product.description && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{product.description}</p>
                        )}
                        <div className="flex gap-1 mt-2 flex-wrap">
                          {!product.is_available && (
                            <Badge variant="secondary" className="text-xs">Unavailable</Badge>
                          )}
                          {product.calories && (
                            <Badge variant="outline" className="text-xs">{product.calories} cal</Badge>
                          )}
                        </div>
                      </div>
                    </div>
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
