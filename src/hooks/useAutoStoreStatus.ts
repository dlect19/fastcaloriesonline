import { useEffect, useRef, useCallback } from 'react';
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
  const lastAutoSet = useRef<boolean | null>(null);

  const checkAndUpdate = useCallback(async () => {
    if (!vendorId) return;

    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=Sunday
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const { data: hours } = await supabase
      .from('vendor_working_hours')
      .select('open_time, close_time, is_closed')
      .eq('vendor_id', vendorId)
      .eq('day_of_week', dayOfWeek)
      .maybeSingle();

    if (!hours) return; // No schedule set, don't auto-toggle

    const shouldBeOpen = !hours.is_closed && currentTime >= hours.open_time && currentTime < hours.close_time;

    // Only update if the auto-computed status differs from current
    if (shouldBeOpen !== (currentIsOpen ?? true) && shouldBeOpen !== lastAutoSet.current) {
      lastAutoSet.current = shouldBeOpen;

      const { error } = await supabase
        .from('vendors')
        .update({ is_open: shouldBeOpen })
        .eq('id', vendorId);

      if (!error) {
        onStatusChange(shouldBeOpen);
      }
    }
  }, [vendorId, currentIsOpen, onStatusChange]);

  useEffect(() => {
    if (!vendorId) return;

    // Check immediately on mount
    checkAndUpdate();

    // Then check every 60 seconds
    const interval = setInterval(checkAndUpdate, 60_000);
    return () => clearInterval(interval);
  }, [vendorId, checkAndUpdate]);
}
