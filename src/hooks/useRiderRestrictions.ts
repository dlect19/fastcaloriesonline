import { useMemo } from 'react';

interface RiderProfile {
  affiliated_vendor_id?: string | null;
  delivery_company_id?: string | null;
  [key: string]: any;
}

interface RiderRestrictions {
  isAffiliated: boolean;
  affiliatedVendorId: string | null;
  isDeliveryCompanyRider: boolean;
  deliveryCompanyId: string | null;
  canViewEarnings: boolean;
  canViewAllOrders: boolean;
  canWithdraw: boolean;
}

export function useRiderRestrictions(riderProfile: RiderProfile | null): RiderRestrictions {
  return useMemo(() => {
    const isAffiliated = !!riderProfile?.affiliated_vendor_id;
    const isDeliveryCompanyRider = !!riderProfile?.delivery_company_id;
    
    // Riders affiliated with a vendor or delivery company cannot view earnings or withdraw
    const isRestricted = isAffiliated || isDeliveryCompanyRider;
    
    return {
      isAffiliated,
      affiliatedVendorId: riderProfile?.affiliated_vendor_id || null,
      isDeliveryCompanyRider,
      deliveryCompanyId: riderProfile?.delivery_company_id || null,
      canViewEarnings: !isRestricted, // Only platform riders can see earnings
      canViewAllOrders: !isRestricted, // Only platform riders see all orders
      canWithdraw: !isRestricted, // Only platform riders can withdraw
    };
  }, [riderProfile?.affiliated_vendor_id, riderProfile?.delivery_company_id]);
}
