import { MapPin, Navigation, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

interface VendorAccessDeniedProps {
  reason: 'outside_radius' | 'location_required' | 'vendor_not_found' | 'vendor_location_unavailable';
  distance?: number;
  maxRadius?: number;
  onRequestLocation?: () => void;
  locationLoading?: boolean;
}

export function VendorAccessDenied({
  reason,
  distance,
  maxRadius,
  onRequestLocation,
  locationLoading,
}: VendorAccessDeniedProps) {
  const navigate = useNavigate();

  const renderContent = () => {
    switch (reason) {
      case 'outside_radius':
        return (
          <>
            <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mb-4">
              <MapPin className="w-8 h-8 text-warning" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">
              Vendor Not Available in Your Area
            </h2>
            <p className="text-muted-foreground text-center max-w-sm mb-2">
              This vendor is too far from your current location for delivery.
            </p>
            {distance !== undefined && maxRadius !== undefined && (
              <div className="bg-secondary rounded-lg px-4 py-2 mb-4">
                <p className="text-sm text-muted-foreground">
                  Distance: <span className="font-semibold text-foreground">{distance.toFixed(1)} km</span>
                  <span className="mx-2">•</span>
                  Delivery radius: <span className="font-semibold text-foreground">{maxRadius} km</span>
                </p>
              </div>
            )}
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-6">
              Try searching for vendors closer to you, or update your delivery address.
            </p>
          </>
        );

      case 'location_required':
        return (
          <>
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
              <Navigation className="w-8 h-8 text-primary" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">
              Location Required
            </h2>
            <p className="text-muted-foreground text-center max-w-sm mb-6">
              We need your location to check if this vendor can deliver to you. Please enable location access to continue.
            </p>
            {onRequestLocation && (
              <Button onClick={onRequestLocation} disabled={locationLoading} className="mb-4">
                <Navigation className="w-4 h-4 mr-2" />
                {locationLoading ? 'Getting location...' : 'Enable Location'}
              </Button>
            )}
          </>
        );

      case 'vendor_not_found':
        return (
          <>
            <div className="w-16 h-16 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">
              Vendor Not Found
            </h2>
            <p className="text-muted-foreground text-center max-w-sm mb-6">
              This vendor may no longer be available or the link may be incorrect.
            </p>
          </>
        );

      case 'vendor_location_unavailable':
        return (
          <>
            <div className="w-16 h-16 rounded-full bg-warning/10 flex items-center justify-center mb-4">
              <MapPin className="w-8 h-8 text-warning" />
            </div>
            <h2 className="text-xl font-bold text-foreground mb-2">
              Vendor Location Unavailable
            </h2>
            <p className="text-muted-foreground text-center max-w-sm mb-6">
              This vendor hasn't set up their delivery location yet. Please try again later or explore other vendors.
            </p>
          </>
        );
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="flex flex-col items-center text-center">
        {renderContent()}
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => navigate(-1)}>
            Go Back
          </Button>
          <Button onClick={() => navigate('/')}>
            Browse Nearby Vendors
          </Button>
        </div>
      </div>
    </div>
  );
}
