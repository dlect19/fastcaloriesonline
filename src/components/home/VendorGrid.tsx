import { useState, useEffect, useMemo, useRef } from 'react';
import { VendorCard } from './VendorCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { MapPin, Navigation, AlertCircle } from 'lucide-react';
import { useLocationBasedVendors, VendorWithDistance } from '@/hooks/useLocationBasedVendors';
import { formatDistance } from '@/lib/location';
import { supabase } from '@/integrations/supabase/client';

interface VendorGridProps {
  title?: string;
  category?: string;
  /** External location override - when provided, uses this instead of device GPS */
  externalLat?: number | null;
  externalLon?: number | null;
  /** Address state for online vendor matching (e.g., "Lagos") */
  addressState?: string | null;
  /** Live GPS coordinates for accurate distance display on vendor cards */
  gpsLat?: number | null;
  gpsLon?: number | null;
}

export function VendorGrid({ 
  title = 'Nearby Vendors', 
  category = 'all',
  externalLat,
  externalLon,
  addressState,
  gpsLat,
  gpsLon,
}: VendorGridProps) {
  const [gpsDistances, setGpsDistances] = useState<Record<string, number>>({});
  const prevGpsKey = useRef('');

  const {
    vendors,
    loading,
    error,
    noLocationError,
    geoError,
    hasLocation,
    maxRadius,
    refetch,
    requestLocation,
  } = useLocationBasedVendors({
    category,
    externalLat,
    externalLon,
    addressState,
  });

  // Fetch road distances from GPS to each vendor via Google Maps
  useEffect(() => {
    if (!gpsLat || !gpsLon || vendors.length === 0) return;
    const gpsKey = `${gpsLat.toFixed(4)},${gpsLon.toFixed(4)},${vendors.map(v => v.outlet_id || v.id).join(',')}`;
    if (gpsKey === prevGpsKey.current) return;
    prevGpsKey.current = gpsKey;

    const fetchDistances = async () => {
      const results: Record<string, number> = {};
      // Fetch in parallel but limit concurrency
      await Promise.all(
        vendors
          .filter(v => v.latitude && v.longitude)
          .map(async (vendor) => {
            try {
              const { data } = await supabase.functions.invoke('calculate-distance', {
                body: {
                  originLat: gpsLat,
                  originLng: gpsLon,
                  destLat: vendor.latitude,
                  destLng: vendor.longitude,
                },
              });
              if (data?.distanceInKm != null) {
                results[vendor.outlet_id || vendor.id] = data.distanceInKm;
              }
            } catch (e) {
              // Silently fall back to backend distance
            }
          })
      );
      setGpsDistances(results);
    };
    fetchDistances();
  }, [gpsLat, gpsLon, vendors]);

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

  // No location available - prompt user
  if (noLocationError || (!hasLocation && !loading)) {
    return (
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
        </div>
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Navigation className="w-8 h-8 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground mb-2">Enable Location to Find Vendors</h3>
          <p className="text-sm text-muted-foreground mb-4 max-w-sm mx-auto">
            We need your location to show vendors that can deliver to you. Your location is only used to find nearby vendors.
          </p>
          <Button onClick={requestLocation}>
            <Navigation className="w-4 h-4 mr-2" />
            Enable Location
          </Button>
          {geoError && (
            <p className="text-sm text-destructive mt-3">{geoError}</p>
          )}
        </div>
      </section>
    );
  }

  // Error state
  if (error) {
    return (
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
        </div>
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button variant="outline" onClick={refetch}>
            Try Again
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-foreground">{title}</h2>
          {hasLocation && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
              <MapPin className="w-3 h-3" />
              {maxRadius}km
            </span>
          )}
        </div>
        {hasLocation && vendors.length > 0 && (
          <button className="text-sm font-medium text-primary hover:underline">
            See all
          </button>
        )}
      </div>

      {vendors.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
            <MapPin className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="font-semibold text-foreground mb-2">No Vendors Available Near You</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            We couldn't find any vendors within {maxRadius}km of your location. Try updating your delivery address or check back later.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {vendors.map((vendor) => {
            const vendorKey = vendor.outlet_id || vendor.id;
            const displayDistance = gpsDistances[vendorKey] ?? vendor.distance;
            
            return (
              <VendorCard
                key={vendor.outlet_id || vendor.id}
                id={vendor.id}
                outletId={vendor.outlet_id}
                name={(vendor as any).display_name || vendor.name}
                category={vendor.description || `${vendor.category}`}
                rating={vendor.rating || 0}
                deliveryTime={(vendor as any).estimated_delivery_minutes || 30}
                deliveryFee={vendor.dynamic_delivery_fee}
                isOpen={vendor.is_open ?? true}
                imageUrl={vendor.banner_url || undefined}
                distance={formatDistance(displayDistance)}
                storeType={(vendor as any).store_type}
                socialMediaHandles={(vendor as any).social_media_handles}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
