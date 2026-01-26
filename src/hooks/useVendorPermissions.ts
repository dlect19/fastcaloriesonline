import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type VendorStaffRole = 'owner' | 'manager' | 'cashier' | 'viewer';

export type VendorPermission = 
  | 'view_dashboard'
  | 'manage_menu'
  | 'process_orders'
  | 'view_earnings'
  | 'request_withdrawal'
  | 'manage_staff'
  | 'edit_settings'
  | 'manage_promos'
  | 'manage_riders';

const ROLE_PERMISSIONS: Record<VendorStaffRole, VendorPermission[]> = {
  owner: [
    'view_dashboard', 'manage_menu', 'process_orders', 'view_earnings',
    'request_withdrawal', 'manage_staff', 'edit_settings', 'manage_promos', 'manage_riders'
  ],
  manager: [
    'view_dashboard', 'manage_menu', 'process_orders', 'view_earnings',
    'manage_promos', 'manage_riders'
  ],
  cashier: ['view_dashboard', 'process_orders'],
  viewer: ['view_dashboard']
};

interface UseVendorPermissionsResult {
  role: VendorStaffRole | null;
  loading: boolean;
  hasPermission: (permission: VendorPermission) => boolean;
  isOwner: boolean;
  permissions: VendorPermission[];
}

export function useVendorPermissions(vendorId: string | null): UseVendorPermissionsResult {
  const { user } = useAuth();
  const [role, setRole] = useState<VendorStaffRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !vendorId) {
      setLoading(false);
      return;
    }

    const fetchRole = async () => {
      try {
        // First check if user is the vendor owner (from vendors table)
        const { data: vendor } = await supabase
          .from('vendors')
          .select('user_id')
          .eq('id', vendorId)
          .single();

        if (vendor?.user_id === user.id) {
          setRole('owner');
          setLoading(false);
          return;
        }

        // Then check vendor_staff table
        const { data: staffRecord } = await supabase
          .from('vendor_staff')
          .select('role')
          .eq('vendor_id', vendorId)
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (staffRecord) {
          setRole(staffRecord.role as VendorStaffRole);
        } else {
          setRole(null);
        }
      } catch (error) {
        console.error('Error fetching vendor role:', error);
        setRole(null);
      } finally {
        setLoading(false);
      }
    };

    fetchRole();
  }, [user, vendorId]);

  const hasPermission = (permission: VendorPermission): boolean => {
    if (!role) return false;
    return ROLE_PERMISSIONS[role].includes(permission);
  };

  const permissions = role ? ROLE_PERMISSIONS[role] : [];
  const isOwner = role === 'owner';

  return { role, loading, hasPermission, isOwner, permissions };
}
