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
      setReady(false);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setVendorId(null);
        setSelectedOutletId(null);
        setReady(true);
        return;
      }

      const { data: vendor } = await supabase
        .from('vendors')
        .select('id')
        .eq('user_id', user.id)
        .maybeSingle();

      if (vendor) {
        setVendorId(vendor.id);
        return;
      }

      const { data: staff } = await supabase
        .from('vendor_staff')
        .select('vendor_id')
        .eq('user_id', user.id)
        .eq('is_active', true)
        .maybeSingle();

      if (staff) {
        setVendorId(staff.vendor_id);
        return;
      }

      setVendorId(null);
      setSelectedOutletId(null);
      setReady(true);
    };

    resolve();
  }, []);

  // Resolve outlet from localStorage; fallback to default outlet for vendor
  useEffect(() => {
    const resolveOutlet = async () => {
      if (!vendorId) return;

      setReady(false);
      const key = `selected_outlet_${vendorId}`;

      try {
        const storedOutletId = localStorage.getItem(key);

        if (storedOutletId) {
          const { data: storedOutlet } = await supabase
            .from('vendor_outlets')
            .select('id')
            .eq('id', storedOutletId)
            .eq('vendor_id', vendorId)
            .maybeSingle();

          if (storedOutlet) {
            setSelectedOutletId(storedOutlet.id);
            setReady(true);
            return;
          }
        }

        const { data: fallbackOutlet } = await supabase
          .from('vendor_outlets')
          .select('id')
          .eq('vendor_id', vendorId)
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        const fallbackOutletId = fallbackOutlet?.id ?? null;
        setSelectedOutletId(fallbackOutletId);

        if (fallbackOutletId) {
          localStorage.setItem(key, fallbackOutletId);
        }
      } catch {
        setSelectedOutletId(null);
      } finally {
        setReady(true);
      }
    };

    resolveOutlet();
  }, [vendorId]);

  // Callback for sidebar's onOutletChange — keeps local state in sync
  const handleOutletChange = useCallback((outletId: string | null) => {
    setSelectedOutletId(outletId);

    if (!vendorId) return;

    const key = `selected_outlet_${vendorId}`;
    try {
      if (outletId) {
        localStorage.setItem(key, outletId);
      } else {
        localStorage.removeItem(key);
      }
    } catch {}
  }, [vendorId]);

  return { selectedOutletId, setSelectedOutletId: handleOutletChange, ready };
}

