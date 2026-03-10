import { useState, useEffect, useMemo, useRef } from 'react';
import { VendorCard } from './VendorCard';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { MapPin, Navigation, AlertCircle, ShieldAlert } from 'lucide-react';
import { useLocationBasedVendors, VendorWithDistance } from '@/hooks/useLocationBasedVendors';
import { formatDistance, calculateDistance } from '@/lib/location';

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
  const {
    vendors,
    loading,
    error,
    noLocationError,
    geoError,
    hasLocation,
    maxRadius,
    customerInCoverage,
    coverageAreas,
    refetch,
    requestLocation,
  } = useLocationBasedVendors({
    category,
    externalLat,
    externalLon,
    addressState,
  });

  // Compute GPS distances client-side using Haversine (instant, no network calls)
  const gpsDistances = useMemo(() => {
    if (!gpsLat || !gpsLon || vendors.length === 0) return {};
    const results: Record<string, number> = {};
    for (const vendor of vendors) {
      if (vendor.latitude && vendor.longitude) {
        const key = vendor.outlet_id || vendor.id;
        const dist = calculateDistance(gpsLat, gpsLon, vendor.latitude, vendor.longitude);
        // Round to 1 decimal
        results[key] = Math.round(dist * 10) / 10;
      }
    }
    return results;
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
            {!customerInCoverage ? (
              <ShieldAlert className="w-8 h-8 text-orange-500" />
            ) : (
              <MapPin className="w-8 h-8 text-muted-foreground" />
            )}
          </div>
          <h3 className="font-semibold text-foreground mb-2">
            {!customerInCoverage ? 'Outside Coverage Area' : 'No Vendors Available Near You'}
          </h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            {!customerInCoverage
              ? 'Your location is outside our current delivery coverage zones. We\'re expanding soon!'
              : `We couldn't find any vendors within ${maxRadius}km of your location. Try updating your delivery address or check back later.`}
          </p>
          {!customerInCoverage && coverageAreas.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {coverageAreas.map(area => (
                <span key={area.id} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-secondary text-secondary-foreground">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: area.color }} />
                  {area.name}
                </span>
              ))}
            </div>
          )}
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
