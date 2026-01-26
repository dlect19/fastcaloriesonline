import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { VendorCard } from './VendorCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { MapPin, Navigation } from 'lucide-react';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useDeliverySettings } from '@/hooks/useDeliverySettings';
import { calculateDistance, formatDistance } from '@/lib/location';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;

interface VendorWithDistance extends Vendor {
  distance: number | null;
}

// Fallback mock data for demo when no vendors exist
const mockVendors = [
  {
    id: 'mock-1',
    name: 'Green Bowl Kitchen',
    category: 'restaurant' as const,
    description: 'Healthy • Salads • Bowls',
    rating: 4.8,
    estimated_delivery_minutes: 25,
    delivery_fee: 500,
    is_active: true,
    latitude: 6.5244,
    longitude: 3.3792,
  },
  {
    id: 'mock-2',
    name: "Mama Nkechi's Place",
    category: 'restaurant' as const,
    description: 'Nigerian • Local • Rice',
    rating: 4.6,
    estimated_delivery_minutes: 35,
    delivery_fee: 400,
    is_active: true,
    latitude: 6.5355,
    longitude: 3.3675,
  },
  {
    id: 'mock-3',
    name: 'Fit Meals Lagos',
    category: 'restaurant' as const,
    description: 'Protein • Low Carb • Keto',
    rating: 4.9,
    estimated_delivery_minutes: 30,
    delivery_fee: 600,
    is_active: true,
    latitude: 6.5123,
    longitude: 3.3890,
  },
  {
    id: 'mock-4',
    name: 'HealthPlus Pharmacy',
    category: 'pharmacy' as const,
    description: 'Pharmacy • Vitamins • First Aid',
    rating: 4.7,
    estimated_delivery_minutes: 20,
    delivery_fee: 300,
    is_active: true,
    latitude: 6.5289,
    longitude: 3.3755,
  },
  {
    id: 'mock-5',
    name: 'Fresh Market Express',
    category: 'market' as const,
    description: 'Groceries • Fruits • Vegetables',
    rating: 4.5,
    estimated_delivery_minutes: 40,
    delivery_fee: 350,
    is_active: false,
    latitude: 6.5401,
    longitude: 3.3612,
  },
  {
    id: 'mock-6',
    name: 'Protein Hub',
    category: 'restaurant' as const,
    description: 'Grills • Protein • Healthy',
    rating: 4.4,
    estimated_delivery_minutes: 28,
    delivery_fee: 450,
    is_active: true,
    latitude: 6.5178,
    longitude: 3.3845,
  },
];

interface VendorGridProps {
  title?: string;
  category?: string;
}

export function VendorGrid({ title = 'Nearby Vendors', category = 'all' }: VendorGridProps) {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [useMock, setUseMock] = useState(false);
  
  const { latitude, longitude, loading: geoLoading, error: geoError, getCurrentPosition } = useGeolocation();
  const { settings } = useDeliverySettings();

  useEffect(() => {
    fetchVendors();
  }, []);

  // Request location on mount
  useEffect(() => {
    getCurrentPosition();
  }, []);

  const fetchVendors = async () => {
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .eq('is_active', true)
        .order('rating', { ascending: false });

      if (error) throw error;
      
      if (data && data.length > 0) {
        setVendors(data);
        setUseMock(false);
      } else {
        setUseMock(true);
      }
    } catch (error) {
      console.error('Error fetching vendors:', error);
      setUseMock(true);
    } finally {
      setLoading(false);
    }
  };

  const displayVendors = useMock ? mockVendors : vendors;

  // Calculate distances and filter/sort vendors
  const vendorsWithDistance = useMemo((): VendorWithDistance[] => {
    const filtered = category === 'all' 
      ? displayVendors 
      : displayVendors.filter(v => {
          if (category === 'restaurant') return v.category === 'restaurant';
          if (category === 'pharmacy') return v.category === 'pharmacy';
          if (category === 'market') return v.category === 'market';
          return true;
        });

    // Add distance calculations
    const withDistance = filtered.map(v => {
      const vendorLat = v.latitude;
      const vendorLon = v.longitude;
      
      let distance: number | null = null;
      if (latitude && longitude && vendorLat && vendorLon) {
        distance = calculateDistance(latitude, longitude, vendorLat, vendorLon);
      }

      return {
        ...v,
        distance,
      } as VendorWithDistance;
    });

    // Filter by delivery radius if user has location
    const inRadius = latitude && longitude
      ? withDistance.filter(v => 
          v.distance === null || v.distance <= settings.vendorDeliveryRadiusKm
        )
      : withDistance;

    // Sort by: open status first, then distance
    return inRadius.sort((a, b) => {
      // Open vendors first
      if (a.is_active !== b.is_active) {
        return a.is_active ? -1 : 1;
      }
      // Then by distance (vendors without distance go last)
      if (a.distance === null && b.distance === null) return 0;
      if (a.distance === null) return 1;
      if (b.distance === null) return -1;
      return a.distance - b.distance;
    });
  }, [displayVendors, category, latitude, longitude, settings.vendorDeliveryRadiusKm]);

  if (loading) {
    return (
      <section>
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="bg-card rounded-2xl overflow-hidden border border-border">
              <Skeleton className="h-32 w-full" />
              <div className="p-4 space-y-2">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          {latitude && longitude && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
              <MapPin className="w-3 h-3" />
              {settings.vendorDeliveryRadiusKm}km
            </span>
          )}
        </div>
        {!latitude && !geoLoading && (
          <Button
            variant="ghost"
            size="sm"
            onClick={getCurrentPosition}
            className="text-xs"
          >
            <Navigation className="w-3 h-3 mr-1" />
            Enable location
          </Button>
        )}
        {latitude && longitude && (
          <button className="text-sm font-medium text-primary hover:underline">
            See all
          </button>
        )}
      </div>

      {geoError && (
        <div className="mb-4 p-3 bg-secondary rounded-lg text-sm text-muted-foreground">
          <p>📍 {geoError}</p>
          <p className="text-xs mt-1">Showing all vendors without distance sorting.</p>
        </div>
      )}

      {vendorsWithDistance.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-muted-foreground">No vendors found in this category</p>
          {latitude && longitude && (
            <p className="text-sm text-muted-foreground mt-1">
              within {settings.vendorDeliveryRadiusKm}km of your location
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {vendorsWithDistance.map((vendor) => (
            <VendorCard
              key={vendor.id}
              id={vendor.id}
              name={vendor.name}
              category={vendor.description || `${vendor.category}`}
              rating={vendor.rating || 0}
              deliveryTime={vendor.estimated_delivery_minutes || 30}
              deliveryFee={vendor.delivery_fee || 0}
              isOpen={vendor.is_active ?? true}
              imageUrl={useMock ? undefined : (vendor as Vendor).banner_url || undefined}
              distance={vendor.distance !== null ? formatDistance(vendor.distance) : undefined}
            />
          ))}
        </div>
      )}
    </section>
  );
}
