import { useMemo } from 'react';

interface RiderProfile {
  affiliated_vendor_id?: string | null;
  [key: string]: any;
}

interface RiderRestrictions {
  isAffiliated: boolean;
  affiliatedVendorId: string | null;
  canViewEarnings: boolean;
  canViewAllOrders: boolean;
}

export function useRiderRestrictions(riderProfile: RiderProfile | null): RiderRestrictions {
  return useMemo(() => {
    const isAffiliated = !!riderProfile?.affiliated_vendor_id;
    
    return {
      isAffiliated,
      affiliatedVendorId: riderProfile?.affiliated_vendor_id || null,
      canViewEarnings: !isAffiliated, // Platform riders can see earnings
      canViewAllOrders: !isAffiliated, // Platform riders see all orders
    };
  }, [riderProfile?.affiliated_vendor_id]);
}
