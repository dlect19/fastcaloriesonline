import { useState, useEffect } from 'react';
import { Search, Filter, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { VendorCard } from '@/components/home/VendorCard';
import { BottomNav } from '@/components/home/BottomNav';
import { CartButton } from '@/components/cart/CartButton';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;
type Product = Tables<'products'>;

const categories = [
  { id: 'all', label: 'All' },
  { id: 'restaurant', label: 'Restaurants' },
  { id: 'pharmacy', label: 'Pharmacy' },
  { id: 'market', label: 'Market' },
];

const calorieFilters = [
  { id: 'all', label: 'Any Calories', min: 0, max: Infinity },
  { id: 'low', label: 'Under 300 cal', min: 0, max: 300 },
  { id: 'medium', label: '300-500 cal', min: 300, max: 500 },
  { id: 'high', label: '500+ cal', min: 500, max: Infinity },
];

export default function Explore() {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedCalorieFilter, setSelectedCalorieFilter] = useState('all');
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [vendorsRes, productsRes] = await Promise.all([
        supabase.from('vendors').select('*').eq('is_active', true),
        supabase.from('products').select('*').eq('is_available', true),
      ]);

      if (vendorsRes.data) setVendors(vendorsRes.data);
      if (productsRes.data) setProducts(productsRes.data);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter vendors based on search and category
  const filteredVendors = vendors.filter((vendor) => {
    const matchesSearch =
      searchQuery === '' ||
      vendor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vendor.description?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === 'all' || vendor.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  // Filter products based on search and calorie filter
  const calorieRange = calorieFilters.find((f) => f.id === selectedCalorieFilter);
  const filteredProducts = products.filter((product) => {
    const matchesSearch =
      searchQuery === '' ||
      product.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      product.description?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCalories =
      selectedCalorieFilter === 'all' ||
      (product.calories !== null &&
        product.calories >= (calorieRange?.min || 0) &&
        product.calories < (calorieRange?.max || Infinity));

    return matchesSearch && matchesCalories;
  });

  const clearFilters = () => {
    setSelectedCategory('all');
    setSelectedCalorieFilter('all');
    setSearchQuery('');
  };

  const hasActiveFilters =
    selectedCategory !== 'all' ||
    selectedCalorieFilter !== 'all' ||
    searchQuery !== '';

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="container py-4 space-y-3">
          <h1 className="text-xl font-bold text-foreground">Explore</h1>

          {/* Search Bar */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Search vendors or products..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 pr-10 h-12 rounded-xl bg-secondary border-0"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Filter Toggle */}
          <div className="flex items-center gap-2">
            <Button
              variant={showFilters ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="gap-2"
            >
              <Filter className="w-4 h-4" />
              Filters
              {hasActiveFilters && (
                <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center">
                  !
                </Badge>
              )}
            </Button>
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters}>
                Clear all
              </Button>
            )}
          </div>

          {/* Filter Options */}
          {showFilters && (
            <div className="space-y-3 pt-2">
              {/* Category Filter */}
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Category</p>
                <div className="flex flex-wrap gap-2">
                  {categories.map((cat) => (
                    <Button
                      key={cat.id}
                      variant={selectedCategory === cat.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedCategory(cat.id)}
                      className="rounded-full"
                    >
                      {cat.label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Calorie Filter */}
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">Calories</p>
                <div className="flex flex-wrap gap-2">
                  {calorieFilters.map((filter) => (
                    <Button
                      key={filter.id}
                      variant={selectedCalorieFilter === filter.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setSelectedCalorieFilter(filter.id)}
                      className="rounded-full"
                    >
                      {filter.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="container py-6 space-y-8">
        {loading ? (
          <div className="space-y-4">
            <Skeleton className="h-6 w-32" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div key={i} className="bg-card rounded-2xl overflow-hidden border border-border">
                  <Skeleton className="h-32 w-full" />
                  <div className="p-4 space-y-2">
                    <Skeleton className="h-5 w-3/4" />
                    <Skeleton className="h-4 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Vendors Section */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-foreground">
                  Vendors {filteredVendors.length > 0 && `(${filteredVendors.length})`}
                </h2>
              </div>

              {filteredVendors.length === 0 ? (
                <div className="text-center py-8 bg-card rounded-2xl border border-border">
                  <p className="text-muted-foreground">No vendors found</p>
                  <Button variant="link" onClick={clearFilters} className="mt-2">
                    Clear filters
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredVendors.map((vendor) => (
                    <VendorCard
                      key={vendor.id}
                      id={vendor.id}
                      name={vendor.name}
                      category={vendor.description || vendor.category}
                      rating={vendor.rating || 0}
                      deliveryTime={vendor.estimated_delivery_minutes || 30}
                      deliveryFee={vendor.delivery_fee || 0}
                      isOpen={vendor.is_active ?? true}
                      imageUrl={vendor.banner_url || undefined}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Products Section (when searching) */}
            {searchQuery && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-foreground">
                    Products {filteredProducts.length > 0 && `(${filteredProducts.length})`}
                  </h2>
                </div>

                {filteredProducts.length === 0 ? (
                  <div className="text-center py-8 bg-card rounded-2xl border border-border">
                    <p className="text-muted-foreground">No products found</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {filteredProducts.slice(0, 12).map((product) => (
                      <div
                        key={product.id}
                        className="bg-card rounded-2xl p-4 border border-border hover:shadow-card transition-shadow"
                      >
                        <div className="flex gap-3">
                          {product.image_url ? (
                            <img
                              src={product.image_url}
                              alt={product.name}
                              className="w-20 h-20 rounded-xl object-cover"
                            />
                          ) : (
                            <div className="w-20 h-20 rounded-xl bg-muted flex items-center justify-center text-2xl">
                              🍽️
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-foreground truncate">{product.name}</h3>
                            <p className="text-sm text-muted-foreground line-clamp-2">
                              {product.description}
                            </p>
                            <div className="flex items-center justify-between mt-2">
                              <span className="font-bold text-primary">
                                ₦{product.price.toLocaleString()}
                              </span>
                              {product.calories && (
                                <Badge variant="secondary" className="text-xs">
                                  {product.calories} cal
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      <CartButton />
      <BottomNav />
    </div>
  );
}
