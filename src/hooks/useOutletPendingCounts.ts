import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Returns a map of { [outletId]: pendingOrderCount } for the given vendor,
 * counting orders in pending/confirmed/preparing states. Live-updates via realtime.
 */
export function useOutletPendingCounts(vendorId: string | null | undefined) {
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!vendorId) {
      setCounts({});
      return;
    }

    let mounted = true;

    const fetchCounts = async () => {
      const { data, error } = await supabase
        .from('orders')
        .select('outlet_id')
        .eq('vendor_id', vendorId)
        .in('status', ['pending', 'confirmed', 'preparing'])
        .eq('payment_status', 'paid');

      if (error || !mounted || !data) return;

      const map: Record<string, number> = {};
      for (const row of data as { outlet_id: string | null }[]) {
        if (!row.outlet_id) continue;
        map[row.outlet_id] = (map[row.outlet_id] || 0) + 1;
      }
      setCounts(map);
    };

    fetchCounts();

    const channel = supabase
      .channel(`outlet-pending-counts-${vendorId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          filter: `vendor_id=eq.${vendorId}`,
        },
        () => fetchCounts()
      )
      .subscribe();

    return () => {
      mounted = false;
      supabase.removeChannel(channel);
    };
  }, [vendorId]);

  return counts;
}
