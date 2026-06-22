import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Search, Filter, X, Navigation, MapPin, ArrowLeft, UtensilsCrossed } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { VendorCard } from '@/components/home/VendorCard';
import { BottomNav } from '@/components/home/BottomNav';
import { CartButton } from '@/components/cart/CartButton';
import { supabase } from '@/integrations/supabase/client';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useLocationBasedVendors, VendorWithDistance, checkVendorAccess } from '@/hooks/useLocationBasedVendors';
import { formatDistance } from '@/lib/location';
import { useCuisineCategories } from '@/hooks/useCuisineCategories';
import type { Tables } from '@/integrations/supabase/types';

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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialQuery = searchParams.get('q') || '';
  const cuisineId = searchParams.get('cuisine');
  const viewMode = searchParams.get('view'); // 'cuisines' shows the cuisine grid
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedCategory, setSelectedCategory] = useState('all');
  const [selectedCalorieFilter, setSelectedCalorieFilter] = useState('all');
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [cuisineVendorIds, setCuisineVendorIds] = useState<Set<string> | null>(null);

  const { categories: cuisineCategories, loading: cuisinesLoading } = useCuisineCategories();
  const selectedCuisine = cuisineId
    ? cuisineCategories.find((c) => c.id === cuisineId)
    : null;

  const { latitude, longitude, loading: geoLoading, getCurrentPosition } = useGeolocation();
  const hasLocation = latitude !== null && longitude !== null;

  // Use location-based vendor discovery
  const {
    vendors,
    loading: vendorsLoading,
    error: vendorsError,
    noLocationError,
    maxRadius,
    requestLocation,
  } = useLocationBasedVendors({
    category: selectedCategory,
    enabled: true,
  });

  // Initialize search from URL query param
  useEffect(() => {
    const queryFromUrl = searchParams.get('q');
    if (queryFromUrl) {
      setSearchQuery(queryFromUrl);
    }
  }, [searchParams]);

  // Request location on mount
  useEffect(() => {
    getCurrentPosition();
  }, []);

  useEffect(() => {
    fetchProducts();
  }, []);

  // When a cuisine filter is active, fetch vendor_ids that have available products in that cuisine
  useEffect(() => {
    let cancelled = false;
    if (!cuisineId) {
      setCuisineVendorIds(null);
      return;
    }
    (async () => {
      const { data, error } = await supabase
        .from('products')
        .select('vendor_id')
        .eq('cuisine_category_id', cuisineId)
        .eq('is_available', true)
        .eq('is_hidden', false);
      if (cancelled) return;
      if (error) {
        console.error('cuisine vendor filter error:', error);
        setCuisineVendorIds(new Set());
        return;
      }
      setCuisineVendorIds(new Set((data || []).map((r: any) => r.vendor_id)));
    })();
    return () => {
      cancelled = true;
    };
  }, [cuisineId]);

  const fetchProducts = async () => {
    try {
      const { data: productsRes, error } = await supabase
        .from('products')
        .select('id, name, description, price, image_url, calories, vendor_id, cuisine_category_id, is_available, is_hidden')
        .eq('is_available', true)
        .eq('is_hidden', false);

      if (error) throw error;
      if (productsRes) setProducts(productsRes as any);
    } catch (error) {
      console.error('Error fetching products:', error);
    } finally {
      setLoading(false);
    }
  };

  // Filter vendors based on search + active cuisine
  const filteredVendors = vendors.filter((vendor) => {
    const displayName = (vendor as any).display_name || vendor.name;
    const matchesSearch =
      searchQuery === '' ||
      displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vendor.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      vendor.description?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCuisine = !cuisineVendorIds || cuisineVendorIds.has(vendor.id);

    return matchesSearch && matchesCuisine;
  });

  // Filter products based on search and calorie filter
  // Only show products from nearby vendors
  const nearbyVendorIds = new Set(vendors.map(v => v.id));
  const vendorNameById = new Map(vendors.map(v => [v.id, (v as any).display_name || v.name]));
  const calorieRange = calorieFilters.find((f) => f.id === selectedCalorieFilter);
  const filteredProducts = products.filter((product) => {
    // Only show products from nearby vendors
    if (!nearbyVendorIds.has(product.vendor_id)) return false;

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

  // When a cuisine is selected, show menu items from that cuisine across all
  // nearby vendors (cross-vendor menu browsing).
  const cuisineProducts = cuisineId
    ? products.filter((p) =>
        (p as any).cuisine_category_id === cuisineId &&
        nearbyVendorIds.has(p.vendor_id) &&
        (searchQuery === '' ||
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.description?.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : [];

  const clearFilters = () => {
    setSelectedCategory('all');
    setSelectedCalorieFilter('all');
    setSearchQuery('');
  };

  const hasActiveFilters =
    selectedCategory !== 'all' ||
    selectedCalorieFilter !== 'all' ||
    searchQuery !== '';

  const isLoading = loading || vendorsLoading || geoLoading;

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="container py-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              {(cuisineId || viewMode === 'cuisines') && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  onClick={() => navigate('/explore')}
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>
              )}
              <h1 className="text-xl font-bold text-foreground truncate">
                {viewMode === 'cuisines'
                  ? 'Browse by Food'
                  : selectedCuisine
                  ? `${selectedCuisine.icon || ''} ${selectedCuisine.name}`
                  : 'Explore'}
              </h1>
            </div>
            {hasLocation && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary px-2 py-1 rounded-full shrink-0">
                <MapPin className="w-3 h-3" />
                {maxRadius}km radius
              </span>
            )}
          </div>

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
        {/* Cuisine grid view */}
        {viewMode === 'cuisines' && (
          <section>
            <p className="text-sm text-muted-foreground mb-4">
              Tap a category to see vendors near you that serve it.
            </p>
            {cuisinesLoading ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {Array.from({ length: 12 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-2xl" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                {cuisineCategories.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => setSearchParams({ cuisine: c.id })}
                    className="flex flex-col items-center justify-center gap-2 p-3 rounded-2xl bg-card border border-border hover:border-primary hover:bg-secondary transition-all"
                  >
                    <span className="text-3xl">
                      {c.icon || <UtensilsCrossed className="w-7 h-7 text-muted-foreground" />}
                    </span>
                    <span className="text-xs font-medium text-foreground text-center line-clamp-2">
                      {c.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}

        {/* No Location Warning */}
        {noLocationError && !geoLoading && (
          <div className="bg-card rounded-2xl border border-border p-8 text-center">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Navigation className="w-8 h-8 text-primary" />
            </div>
            <h3 className="font-semibold text-foreground mb-2">Enable Location to Explore</h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
              We need your location to show vendors that can deliver to you.
            </p>
            <Button onClick={requestLocation}>
              <Navigation className="w-4 h-4 mr-2" />
              Enable Location
            </Button>
          </div>
        )}

        {isLoading ? (
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
        ) : !noLocationError && (
          <>
            {/* Cuisine-filtered menu items across vendors (shown FIRST when a category is selected) */}
            {cuisineId && (
              <section>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold text-foreground">
                    {selectedCuisine?.icon} {selectedCuisine?.name} near you
                    {cuisineProducts.length > 0 && ` (${cuisineProducts.length})`}
                  </h2>
                </div>
                {cuisineProducts.length === 0 ? (
                  <div className="text-center py-8 bg-card rounded-2xl border border-border">
                    <UtensilsCrossed className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground text-sm">
                      No menu items in this category from nearby vendors yet.
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {cuisineProducts.map((product) => {
                      const vendorName = vendorNameById.get(product.vendor_id) || 'Vendor';
                      return (
                        <button
                          key={product.id}
                          onClick={() => navigate(`/vendor/${product.vendor_id}`)}
                          className="text-left bg-card rounded-2xl p-4 border border-border hover:shadow-card hover:border-primary/40 transition-all"
                        >
                          <div className="flex gap-3">
                            {product.image_url ? (
                              <img
                                src={product.image_url}
                                alt={product.name}
                                className="w-20 h-20 rounded-xl object-cover shrink-0"
                              />
                            ) : (
                              <div className="w-20 h-20 rounded-xl bg-muted flex items-center justify-center text-2xl shrink-0">
                                🍽️
                              </div>
                            )}
                            <div className="flex-1 min-w-0">
                              <h3 className="font-semibold text-foreground truncate">{product.name}</h3>
                              <p className="text-xs text-muted-foreground truncate">from {vendorName}</p>
                              {product.description && (
                                <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                                  {product.description}
                                </p>
                              )}
                              <div className="flex items-center justify-between mt-2">
                                <span className="font-bold text-primary">
                                  ₦{Number(product.price).toLocaleString()}
                                </span>
                                {product.calories && (
                                  <Badge variant="secondary" className="text-xs">
                                    {product.calories} cal
                                  </Badge>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {/* Vendors Section */}
            <section>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-foreground">
                  Nearby Vendors {filteredVendors.length > 0 && `(${filteredVendors.length})`}
                </h2>
              </div>

              {filteredVendors.length === 0 ? (
                <div className="text-center py-8 bg-card rounded-2xl border border-border">
                  <MapPin className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-muted-foreground">
                    {searchQuery ? 'No vendors match your search' : 'No vendors found nearby'}
                  </p>
                  {hasActiveFilters && (
                    <Button variant="link" onClick={clearFilters} className="mt-2">
                      Clear filters
                    </Button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredVendors.map((vendor) => (
                    <VendorCard
                      key={(vendor as any).outlet_id || vendor.id}
                      id={vendor.id}
                      outletId={(vendor as any).outlet_id}
                      name={(vendor as any).display_name || vendor.name}
                      category={vendor.description || vendor.category}
                      rating={vendor.rating || 0}
                      deliveryTime={vendor.estimated_delivery_minutes || 30}
                      deliveryFee={vendor.dynamic_delivery_fee}
                      isOpen={vendor.is_active ?? true}
                      imageUrl={vendor.banner_url || undefined}
                      distance={formatDistance(vendor.distance)}
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
                    <p className="text-muted-foreground">No products found from nearby vendors</p>
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
