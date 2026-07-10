import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Automatically closes/opens the store based on vendor_working_hours.
 * Checks every 60 seconds whether the current time falls within open hours.
 * Self-contained: fetches current is_open from DB, no external state needed.
 */
export function useAutoStoreStatus(vendorId: string | null) {
  const vendorIdRef = useRef(vendorId);
  vendorIdRef.current = vendorId;

  useEffect(() => {
    if (!vendorId) return;

    const checkAndUpdate = async () => {
      const vid = vendorIdRef.current;
      if (!vid) return;

      // Use Africa/Lagos (WAT, UTC+1) regardless of device timezone
      const nowUtc = new Date();
      const wat = new Date(nowUtc.getTime() + 60 * 60 * 1000);
      const dayOfWeek = wat.getUTCDay();
      const currentTime = `${String(wat.getUTCHours()).padStart(2, '0')}:${String(wat.getUTCMinutes()).padStart(2, '0')}:${String(wat.getUTCSeconds()).padStart(2, '0')}`;

      // Fetch working hours and current vendor status in parallel
      const [hoursResult, vendorResult] = await Promise.all([
        supabase
          .from('vendor_working_hours')
          .select('open_time, close_time, is_closed')
          .eq('vendor_id', vid)
          .eq('day_of_week', dayOfWeek)
          .maybeSingle(),
        supabase
          .from('vendors')
          .select('is_open')
          .eq('id', vid)
          .single(),
      ]);

      const hours = hoursResult.data;
      const vendor = vendorResult.data;
      if (!hours || !vendor) return;

      const openTime = hours.open_time.length === 5 ? hours.open_time + ':00' : hours.open_time;
      const closeTime = hours.close_time.length === 5 ? hours.close_time + ':00' : hours.close_time;

      const shouldBeOpen = !hours.is_closed && currentTime >= openTime && currentTime < closeTime;
      const actuallyOpen = vendor.is_open ?? true;

      if (shouldBeOpen !== actuallyOpen) {
        await supabase
          .from('vendors')
          .update({ is_open: shouldBeOpen })
          .eq('id', vid);
      }
    };

    checkAndUpdate();
    const interval = setInterval(checkAndUpdate, 60_000);
    return () => clearInterval(interval);
  }, [vendorId]);
}
