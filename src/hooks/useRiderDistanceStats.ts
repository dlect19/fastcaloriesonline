import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface DistanceStats {
  today: number;
  thisWeek: number;
  thisMonth: number;
  thisYear: number;
  filtered: number;
}

interface UseRiderDistanceStatsOptions {
  riderId: string | null;
  dateFrom?: Date;
  dateTo?: Date;
}

export function useRiderDistanceStats({ riderId, dateFrom, dateTo }: UseRiderDistanceStatsOptions) {
  const [stats, setStats] = useState<DistanceStats>({ today: 0, thisWeek: 0, thisMonth: 0, thisYear: 0, filtered: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!riderId) return;
    fetchStats();
  }, [riderId, dateFrom?.toISOString(), dateTo?.toISOString()]);

  const fetchStats = async () => {
    if (!riderId) return;
    setLoading(true);

    try {
      const now = new Date();

      // Today
      const todayStart = new Date(now);
      todayStart.setHours(0, 0, 0, 0);

      // This week (Monday start)
      const weekStart = new Date(now);
      const dayOfWeek = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      weekStart.setHours(0, 0, 0, 0);

      // This month
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      // This year
      const yearStart = new Date(now.getFullYear(), 0, 1);

      const [todayRes, weekRes, monthRes, yearRes, filteredRes] = await Promise.all([
        supabase.from('rider_distance_logs').select('distance_km').eq('rider_user_id', riderId).gte('created_at', todayStart.toISOString()),
        supabase.from('rider_distance_logs').select('distance_km').eq('rider_user_id', riderId).gte('created_at', weekStart.toISOString()),
        supabase.from('rider_distance_logs').select('distance_km').eq('rider_user_id', riderId).gte('created_at', monthStart.toISOString()),
        supabase.from('rider_distance_logs').select('distance_km').eq('rider_user_id', riderId).gte('created_at', yearStart.toISOString()),
        dateFrom
          ? supabase.from('rider_distance_logs').select('distance_km').eq('rider_user_id', riderId)
              .gte('created_at', dateFrom.toISOString())
              .lt('created_at', (dateTo ? new Date(dateTo.getTime() + 86400000) : new Date(dateFrom.getTime() + 86400000)).toISOString())
          : Promise.resolve({ data: null }),
      ]);

      const sum = (data: { distance_km: number }[] | null) =>
        (data || []).reduce((s, r) => s + Number(r.distance_km), 0);

      setStats({
        today: Math.round(sum(todayRes.data) * 10) / 10,
        thisWeek: Math.round(sum(weekRes.data) * 10) / 10,
        thisMonth: Math.round(sum(monthRes.data) * 10) / 10,
        thisYear: Math.round(sum(yearRes.data) * 10) / 10,
        filtered: Math.round(sum(filteredRes.data) * 10) / 10,
      });
    } catch (err) {
      console.error('Error fetching distance stats:', err);
    } finally {
      setLoading(false);
    }
  };

  return { stats, loading, refetch: fetchStats };
}

/**
 * Log delivery distance when a rider completes a delivery.
 * Fetches distance from the dispatch_offers table.
 */
export async function logDeliveryDistance(orderId: string, riderId: string) {
  try {
    // Check if already logged
    const { data: existing } = await supabase
      .from('rider_distance_logs')
      .select('id')
      .eq('order_id', orderId)
      .eq('rider_user_id', riderId)
      .maybeSingle();

    if (existing) return; // Already logged

    // Get distance from dispatch_offers
    const { data: offer } = await supabase
      .from('dispatch_offers')
      .select('distance_km')
      .eq('rider_user_id', riderId)
      .eq('status', 'accepted')
      .eq('dispatch_request_id', (
        await supabase.from('dispatch_requests').select('id').eq('order_id', orderId).single()
      ).data?.id || '')
      .maybeSingle();

    // Fallback: get distance from order's delivery address and vendor
    let distanceKm = offer?.distance_km || 0;

    if (!distanceKm) {
      // Try getting from dispatch_requests directly
      const { data: request } = await supabase
        .from('dispatch_requests')
        .select('vendor_latitude, vendor_longitude, customer_latitude, customer_longitude')
        .eq('order_id', orderId)
        .maybeSingle();

      if (request?.vendor_latitude && request?.vendor_longitude && request?.customer_latitude && request?.customer_longitude) {
        const R = 6371;
        const dLat = (request.customer_latitude - request.vendor_latitude) * Math.PI / 180;
        const dLon = (request.customer_longitude - request.vendor_longitude) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
          Math.cos(request.vendor_latitude * Math.PI / 180) * Math.cos(request.customer_latitude * Math.PI / 180) *
          Math.sin(dLon / 2) ** 2;
        distanceKm = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      }
    }

    if (distanceKm > 0) {
      const env = (await supabase.from('platform_settings').select('value').eq('key', 'platform_environment').single()).data?.value || 'production';

      await supabase.from('rider_distance_logs').insert({
        rider_user_id: riderId,
        order_id: orderId,
        distance_km: Math.round(distanceKm * 10) / 10,
        environment: env,
      });
    }
  } catch (err) {
    console.error('Error logging delivery distance:', err);
  }
}
