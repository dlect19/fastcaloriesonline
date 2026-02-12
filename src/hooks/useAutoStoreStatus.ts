import { useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Automatically closes/opens the store based on vendor_working_hours.
 * Checks every 60 seconds whether the current time falls within open hours.
 */
export function useAutoStoreStatus(
  vendorId: string | null,
  currentIsOpen: boolean | null,
  onStatusChange: (isOpen: boolean) => void
) {
  const vendorIdRef = useRef(vendorId);
  const currentIsOpenRef = useRef(currentIsOpen);
  const onStatusChangeRef = useRef(onStatusChange);

  // Keep refs in sync without causing re-renders
  vendorIdRef.current = vendorId;
  currentIsOpenRef.current = currentIsOpen;
  onStatusChangeRef.current = onStatusChange;

  useEffect(() => {
    if (!vendorId) return;

    const checkAndUpdate = async () => {
      const vid = vendorIdRef.current;
      if (!vid) return;

      const now = new Date();
      const dayOfWeek = now.getDay();
      // Pad to HH:MM:SS to match DB format
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

      const { data: hours } = await supabase
        .from('vendor_working_hours')
        .select('open_time, close_time, is_closed')
        .eq('vendor_id', vid)
        .eq('day_of_week', dayOfWeek)
        .maybeSingle();

      if (!hours) return;

      // Normalize DB times to ensure consistent comparison
      const openTime = hours.open_time.length === 5 ? hours.open_time + ':00' : hours.open_time;
      const closeTime = hours.close_time.length === 5 ? hours.close_time + ':00' : hours.close_time;

      const shouldBeOpen = !hours.is_closed && currentTime >= openTime && currentTime < closeTime;
      const actuallyOpen = currentIsOpenRef.current ?? true;

      if (shouldBeOpen !== actuallyOpen) {
        const { error } = await supabase
          .from('vendors')
          .update({ is_open: shouldBeOpen })
          .eq('id', vid);

        if (!error) {
          onStatusChangeRef.current(shouldBeOpen);
        }
      }
    };

    // Check immediately
    checkAndUpdate();

    // Then every 60 seconds
    const interval = setInterval(checkAndUpdate, 60_000);
    return () => clearInterval(interval);
  }, [vendorId]);
}
