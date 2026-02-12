import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type DeliveryStaffRole = 'owner' | 'manager' | 'dispatcher' | 'viewer';

export type DeliveryPermission =
  | 'view_dashboard'
  | 'manage_riders'
  | 'view_deliveries'
  | 'view_earnings'
  | 'request_withdrawal'
  | 'manage_staff'
  | 'edit_settings';

const ROLE_PERMISSIONS: Record<DeliveryStaffRole, DeliveryPermission[]> = {
  owner: [
    'view_dashboard', 'manage_riders', 'view_deliveries', 'view_earnings',
    'request_withdrawal', 'manage_staff', 'edit_settings'
  ],
  manager: [
    'view_dashboard', 'manage_riders', 'view_deliveries', 'view_earnings'
  ],
  dispatcher: ['view_dashboard', 'view_deliveries'],
  viewer: ['view_dashboard']
};

interface UseDeliveryPermissionsResult {
  role: DeliveryStaffRole | null;
  loading: boolean;
  hasPermission: (permission: DeliveryPermission) => boolean;
  isOwner: boolean;
  permissions: DeliveryPermission[];
}

export function useDeliveryPermissions(companyId: string | null): UseDeliveryPermissionsResult {
  const { user } = useAuth();
  const [role, setRole] = useState<DeliveryStaffRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [customPermissions, setCustomPermissions] = useState<DeliveryPermission[] | null>(null);

  useEffect(() => {
    if (!user || !companyId) {
      setRole(null);
      setCustomPermissions(null);
      setLoading(false);
      return;
    }

    // Reset loading when companyId changes
    setLoading(true);

    const fetchRole = async () => {
      try {
        // Check delivery_company_staff table
        const { data: staffRecord } = await supabase
          .from('delivery_company_staff')
          .select('role')
          .eq('delivery_company_id', companyId)
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (staffRecord) {
          setRole(staffRecord.role as DeliveryStaffRole);
          // Custom permissions would need to be fetched separately since column may not be in types yet
          setLoading(false);
          return;
        }

        // Check if user is the company owner
        const { data: company } = await supabase
          .from('delivery_companies')
          .select('user_id')
          .eq('id', companyId)
          .single();

        if (company?.user_id === user.id) {
          setRole('owner');
        } else {
          setRole(null);
        }
      } catch (error) {
        console.error('Error fetching delivery company role:', error);
        setRole(null);
      } finally {
        setLoading(false);
      }
    };

    fetchRole();
  }, [user, companyId]);

  const hasPermission = (permission: DeliveryPermission): boolean => {
    if (!role) return false;
    const effectivePerms = customPermissions || ROLE_PERMISSIONS[role];
    return effectivePerms.includes(permission);
  };

  const permissions = customPermissions || (role ? ROLE_PERMISSIONS[role] : []);
  const isOwner = role === 'owner';

  return { role, loading, hasPermission, isOwner, permissions };
}
