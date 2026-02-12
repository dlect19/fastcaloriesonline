import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';

interface UseVendorResolverResult {
  vendorId: string | null;
  loading: boolean;
}

/**
 * Resolves the vendor ID for the current user, checking both
 * owner (vendors table) and staff (vendor_staff table).
 */
export function useVendorResolver(): UseVendorResolverResult {
  const { user, loading: authLoading } = useAuth();
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setLoading(false);
      return;
    }

    const resolve = async () => {
      try {
        // Check if owner
        const { data: vendor } = await supabase
          .from('vendors')
          .select('id')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (vendor) {
          setVendorId(vendor.id);
          setLoading(false);
          return;
        }

        // Check if staff
        const { data: staff } = await supabase
          .from('vendor_staff')
          .select('vendor_id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();

        if (staff) {
          setVendorId(staff.vendor_id);
        }
      } catch (error) {
        console.error('Error resolving vendor:', error);
      } finally {
        setLoading(false);
      }
    };

    resolve();
  }, [user, authLoading]);

  return { vendorId, loading };
}
