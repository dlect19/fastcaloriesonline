import { Star, Clock, Bike, MapPin } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { Tables } from '@/integrations/supabase/types';

type Vendor = Tables<'vendors'>;

interface VendorHeaderProps {
  vendor: Vendor;
}

export function VendorHeader({ vendor }: VendorHeaderProps) {
  const categoryLabels: Record<string, string> = {
    restaurant: '🍽️ Restaurant',
    pharmacy: '💊 Pharmacy',
    market: '🛒 Market',
  };

  return (
    <div className="relative">
      {/* Banner */}
      <div className="h-48 bg-secondary overflow-hidden">
        {vendor.banner_url ? (
          <img
            src={vendor.banner_url}
            alt={vendor.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-primary/30 to-primary/10 flex items-center justify-center">
            <span className="text-6xl">
              {vendor.category === 'restaurant' ? '🍽️' : vendor.category === 'pharmacy' ? '💊' : '🛒'}
            </span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
      </div>

      {/* Vendor Info Card */}
      <div className="container relative -mt-16">
        <div className="bg-card rounded-2xl p-4 border border-border shadow-card">
          <div className="flex gap-4">
            {/* Logo */}
            <div className="w-20 h-20 rounded-xl bg-secondary overflow-hidden shrink-0 border-4 border-background shadow-lg -mt-8">
              {vendor.logo_url ? (
                <img
                  src={vendor.logo_url}
                  alt={vendor.name}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-primary/10 text-3xl">
                  {vendor.category === 'restaurant' ? '🍽️' : vendor.category === 'pharmacy' ? '💊' : '🛒'}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h1 className="text-xl font-bold text-foreground truncate">{vendor.name}</h1>
                  <p className="text-sm text-muted-foreground">{categoryLabels[vendor.category]}</p>
                </div>
                <Badge variant={vendor.is_open ? 'secondary' : 'destructive'} className="shrink-0">
                  {vendor.is_open ? 'Open' : 'Closed'}
                </Badge>
              </div>

              {/* Stats Row */}
              <div className="flex items-center gap-4 mt-3 text-sm">
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 fill-warning text-warning" />
                  <span className="font-semibold text-foreground">
                    {vendor.rating?.toFixed(1) || '0.0'}
                  </span>
                  <span className="text-muted-foreground">
                    ({vendor.total_ratings || 0})
                  </span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="w-4 h-4" />
                  <span>{vendor.estimated_delivery_minutes || 30} min</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Bike className="w-4 h-4" />
                  <span>₦{(vendor.delivery_fee || 0).toLocaleString()}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Description */}
          {vendor.description && (
            <p className="text-sm text-muted-foreground mt-3 line-clamp-2">
              {vendor.description}
            </p>
          )}

          {/* Address */}
          <div className="flex items-center gap-1.5 mt-3 text-sm text-muted-foreground">
            <MapPin className="w-4 h-4 shrink-0" />
            <span className="truncate">{vendor.address}, {vendor.city}</span>
          </div>

          {/* Min Order */}
          {vendor.min_order_amount && vendor.min_order_amount > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Minimum order: ₦{vendor.min_order_amount.toLocaleString()}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
