import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Returns the persisted outlet ID from localStorage so pages start
 * with the correct branch selected before the sidebar callback fires.
 */
export function usePersistedOutletId() {
  const [vendorId, setVendorId] = useState<string | null>(null);
  const [selectedOutletId, setSelectedOutletId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Resolve vendorId once
  useEffect(() => {
    const resolve = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setReady(true); return; }

      const { data: vendor } = await supabase
        .from('vendors')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (vendor) {
        setVendorId(vendor.id);
      } else {
        const { data: staff } = await supabase
          .from('vendor_staff')
          .select('vendor_id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .maybeSingle();
        if (staff) setVendorId(staff.vendor_id);
      }
      setReady(true);
    };
    resolve();
  }, []);

  // Read persisted outlet from localStorage when vendorId is known
  useEffect(() => {
    if (!vendorId) return;
    const key = `selected_outlet_${vendorId}`;
    try {
      const stored = localStorage.getItem(key);
      if (stored) setSelectedOutletId(stored);
    } catch {}
  }, [vendorId]);

  // Callback for sidebar's onOutletChange — keeps local state in sync
  const handleOutletChange = useCallback((outletId: string | null) => {
    setSelectedOutletId(outletId);
  }, []);

  return { selectedOutletId, setSelectedOutletId: handleOutletChange, ready };
}
