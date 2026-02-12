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
  const [customPermissions, setCustomPermissions] = useState<VendorPermission[] | null>(null);

  useEffect(() => {
    if (!user || !vendorId) {
      setRole(null);
      setCustomPermissions(null);
      setLoading(false);
      return;
    }

    // Reset loading when vendorId changes so we don't flash Access Denied
    setLoading(true);

    const fetchRole = async () => {
      try {
    // First check vendor_staff table for explicit role assignment
        const { data: staffRecord } = await supabase
          .from('vendor_staff')
          .select('role, permissions')
          .eq('vendor_id', vendorId)
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (staffRecord) {
          setRole(staffRecord.role as VendorStaffRole);
          // If staff has custom permissions, use those instead of role defaults
          const customPerms = staffRecord.permissions as string[] | null;
          if (customPerms && customPerms.length > 0) {
            setCustomPermissions(customPerms as VendorPermission[]);
          }
      setLoading(false);
      return;
    }

    // If no staff record, check if user is the vendor owner (from vendors table)
    const { data: vendor } = await supabase
      .from('vendors')
      .select('user_id')
      .eq('id', vendorId)
      .single();

    if (vendor?.user_id === user.id) {
      setRole('owner');
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
    // Use custom permissions if set, otherwise fall back to role defaults
    const effectivePerms = customPermissions || ROLE_PERMISSIONS[role];
    return effectivePerms.includes(permission);
  };

  const permissions = customPermissions || (role ? ROLE_PERMISSIONS[role] : []);
  const isOwner = role === 'owner';

  return { role, loading, hasPermission, isOwner, permissions };
}
