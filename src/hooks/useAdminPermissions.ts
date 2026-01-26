import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

export type AdminStaffRole = 'super_admin' | 'admin' | 'support' | 'analyst';

export type AdminPermission = 
  | 'view_dashboard'
  | 'manage_vendors'
  | 'approve_vendors'
  | 'manage_riders'
  | 'process_withdrawals'
  | 'manage_admin_staff'
  | 'platform_settings'
  | 'view_reports'
  | 'handle_support'
  | 'manage_promos'
  | 'manage_users';

const ROLE_PERMISSIONS: Record<AdminStaffRole, AdminPermission[]> = {
  super_admin: [
    'view_dashboard', 'manage_vendors', 'approve_vendors', 'manage_riders',
    'process_withdrawals', 'manage_admin_staff', 'platform_settings',
    'view_reports', 'handle_support', 'manage_promos', 'manage_users'
  ],
  admin: [
    'view_dashboard', 'manage_vendors', 'approve_vendors', 'manage_riders',
    'view_reports', 'handle_support', 'manage_promos', 'manage_users'
  ],
  support: ['view_dashboard', 'view_reports', 'handle_support'],
  analyst: ['view_dashboard', 'view_reports']
};

interface UseAdminPermissionsResult {
  role: AdminStaffRole | null;
  loading: boolean;
  hasPermission: (permission: AdminPermission) => boolean;
  isSuperAdmin: boolean;
  permissions: AdminPermission[];
}

export function useAdminPermissions(): UseAdminPermissionsResult {
  const { user } = useAuth();
  const [role, setRole] = useState<AdminStaffRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }

    const fetchRole = async () => {
      try {
        // First check if user has admin role in user_roles
        const { data: userRole } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .eq('role', 'admin')
          .maybeSingle();

        if (!userRole) {
          setRole(null);
          setLoading(false);
          return;
        }

        // Then check admin_staff table for specific role
        const { data: staffRecord } = await supabase
          .from('admin_staff')
          .select('role')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (staffRecord) {
          setRole(staffRecord.role as AdminStaffRole);
        } else {
          // If user has admin role but no admin_staff record, treat as super_admin (legacy)
          setRole('super_admin');
        }
      } catch (error) {
        console.error('Error fetching admin role:', error);
        setRole(null);
      } finally {
        setLoading(false);
      }
    };

    fetchRole();
  }, [user]);

  const hasPermission = (permission: AdminPermission): boolean => {
    if (!role) return false;
    return ROLE_PERMISSIONS[role].includes(permission);
  };

  const permissions = role ? ROLE_PERMISSIONS[role] : [];
  const isSuperAdmin = role === 'super_admin';

  return { role, loading, hasPermission, isSuperAdmin, permissions };
}
