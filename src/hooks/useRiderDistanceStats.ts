import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface DistanceStats {
  today: number;
  thisWeek: number;
  thisMonth: number;
  thisYear: number;
  lifetime: number;
  filtered: number;
}

export interface DistanceLogEntry {
  id: string;
  order_id: string;
  distance_km: number;
  created_at: string;
}

interface UseRiderDistanceStatsOptions {
  riderId: string | null;
  dateFrom?: Date;
  dateTo?: Date;
}

export function useRiderDistanceStats({ riderId, dateFrom, dateTo }: UseRiderDistanceStatsOptions) {
  const [stats, setStats] = useState<DistanceStats>({ today: 0, thisWeek: 0, thisMonth: 0, thisYear: 0, lifetime: 0, filtered: 0 });
  const [recent, setRecent] = useState<DistanceLogEntry[]>([]);
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
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const weekStart = new Date(now);
      const dayOfWeek = weekStart.getDay();
      weekStart.setDate(weekStart.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
      weekStart.setHours(0, 0, 0, 0);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const yearStart = new Date(now.getFullYear(), 0, 1);

      const [allRes, filteredRes, recentRes] = await Promise.all([
        supabase.from('rider_distance_logs')
          .select('distance_km, created_at')
          .eq('rider_user_id', riderId),
        dateFrom
          ? supabase.from('rider_distance_logs').select('distance_km').eq('rider_user_id', riderId)
              .gte('created_at', dateFrom.toISOString())
              .lt('created_at', (dateTo ? new Date(dateTo.getTime() + 86400000) : new Date(dateFrom.getTime() + 86400000)).toISOString())
          : Promise.resolve({ data: null }),
        supabase.from('rider_distance_logs')
          .select('id, order_id, distance_km, created_at')
          .eq('rider_user_id', riderId)
          .order('created_at', { ascending: false })
          .limit(20),
      ]);

      const rows = (allRes.data || []) as { distance_km: number; created_at: string }[];
      const sumAfter = (from: Date) =>
        rows.filter(r => new Date(r.created_at) >= from).reduce((s, r) => s + Number(r.distance_km), 0);
      const sumAll = (data: { distance_km: number }[] | null) =>
        (data || []).reduce((s, r) => s + Number(r.distance_km), 0);
      const r1 = (n: number) => Math.round(n * 10) / 10;

      setStats({
        today: r1(sumAfter(todayStart)),
        thisWeek: r1(sumAfter(weekStart)),
        thisMonth: r1(sumAfter(monthStart)),
        thisYear: r1(sumAfter(yearStart)),
        lifetime: r1(rows.reduce((s, r) => s + Number(r.distance_km), 0)),
        filtered: r1(sumAll(filteredRes.data)),
      });
      setRecent((recentRes.data || []) as DistanceLogEntry[]);
    } catch (err) {
      console.error('Error fetching distance stats:', err);
    } finally {
      setLoading(false);
    }
  };

  return { stats, recent, loading, refetch: fetchStats };
}

/** Haversine fallback for when Google Maps API is unavailable */
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Try Google Maps Distance Matrix API for accurate road distance */
async function getGoogleMapsDistance(
  originLat: number, originLng: number, destLat: number, destLng: number
): Promise<{ distanceKm: number; durationMinutes: number } | null> {
  try {
    const { data, error } = await supabase.functions.invoke('calculate-distance', {
      body: { originLat, originLng, destLat, destLng },
    });

    if (error || !data?.distanceInKm) {
      console.warn('Google Maps distance failed, using fallback:', error || data?.error);
      return null;
    }

    return { distanceKm: data.distanceInKm, durationMinutes: data.durationInMinutes };
  } catch (err) {
    console.warn('Google Maps distance call error:', err);
    return null;
  }
}

/**
 * Log delivery distance when a rider completes a delivery.
 * Uses Google Maps Distance Matrix API for accurate road distance,
 * with Haversine as fallback.
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

    let distanceKm = 0;
    let originLat: number | null = null;
    let originLng: number | null = null;
    let destLat: number | null = null;
    let destLng: number | null = null;

    // Step 1: Find the dispatch_request for this order (vendor-to-customer coordinates)
    const { data: request } = await supabase
      .from('dispatch_requests')
      .select('id, vendor_latitude, vendor_longitude, customer_latitude, customer_longitude')
      .eq('order_id', orderId)
      .maybeSingle();

    // Note: dispatch_offers.distance_km is rider-to-vendor distance, NOT delivery distance.
    // We always calculate vendor-to-customer distance instead.

    // Collect vendor-to-customer coordinates from dispatch_request
    if (request?.vendor_latitude && request?.vendor_longitude && request?.customer_latitude && request?.customer_longitude) {
      originLat = request.vendor_latitude;
      originLng = request.vendor_longitude;
      destLat = request.customer_latitude;
      destLng = request.customer_longitude;
    }

    // Step 3: If no coordinates from dispatch_request, try order's address vs vendor
    if (!originLat && !distanceKm) {
      const { data: order } = await supabase
        .from('orders')
        .select('vendor_id, delivery_address_id')
        .eq('id', orderId)
        .maybeSingle();

      if (order?.delivery_address_id && order?.vendor_id) {
        const [{ data: address }, { data: vendor }] = await Promise.all([
          supabase.from('addresses').select('latitude, longitude').eq('id', order.delivery_address_id).maybeSingle(),
          supabase.from('vendors').select('latitude, longitude').eq('id', order.vendor_id).maybeSingle(),
        ]);

        if (address?.latitude && address?.longitude && vendor?.latitude && vendor?.longitude) {
          originLat = vendor.latitude;
          originLng = vendor.longitude;
          destLat = address.latitude;
          destLng = address.longitude;
        }
      }
    }

    // Step 4: Use Google Maps API for accurate road distance (primary), Haversine (fallback)
    if (!distanceKm && originLat && originLng && destLat && destLng) {
      const googleResult = await getGoogleMapsDistance(originLat, originLng, destLat, destLng);

      if (googleResult) {
        distanceKm = googleResult.distanceKm;
        console.log(`Google Maps distance for order ${orderId}: ${distanceKm} km (${googleResult.durationMinutes} min)`);
      } else {
        distanceKm = haversineDistance(originLat, originLng, destLat, destLng);
        console.log(`Haversine fallback distance for order ${orderId}: ${Math.round(distanceKm * 10) / 10} km`);
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

      console.log(`Distance logged for order ${orderId}: ${Math.round(distanceKm * 10) / 10} km`);
    } else {
      console.warn(`Could not determine distance for order ${orderId} — no coordinates available`);
    }
  } catch (err) {
    console.error('Error logging delivery distance:', err);
  }
}
