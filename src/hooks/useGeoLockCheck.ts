import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { calculateDistance } from '@/lib/location';
import { useToast } from '@/hooks/use-toast';

interface GeoLockCheckResult {
  passed: boolean;
  distanceM: number;
  locked: boolean;
}

/**
 * Hook for performing geo-lock checks on vendor actions.
 * Checks device GPS against verified vendor coordinates.
 * If distance exceeds tolerance, auto-locks the store.
 */
export function useGeoLockCheck() {
  const { toast } = useToast();

  const checkGeoLock = useCallback(async (
    vendorId: string,
    action: 'store_open_check' | 'order_accept_check'
  ): Promise<GeoLockCheckResult> => {
    // Fetch vendor's verified location and tolerance
    const { data: vendor } = await supabase
      .from('vendors')
      .select('verified_latitude, verified_longitude, tolerance_radius_m, geo_verification_status, user_id')
      .eq('id', vendorId)
      .single();

    if (!vendor) {
      return { passed: true, distanceM: 0, locked: false };
    }

    // If not verified yet, skip check
    if (!vendor.verified_latitude || !vendor.verified_longitude || vendor.geo_verification_status !== 'verified') {
      return { passed: true, distanceM: 0, locked: false };
    }

    // Get current device position
    const position = await new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 30000,
      });
    });

    const deviceLat = position.coords.latitude;
    const deviceLon = position.coords.longitude;
    const distanceKm = calculateDistance(
      deviceLat, deviceLon,
      vendor.verified_latitude, vendor.verified_longitude
    );
    const distanceM = Math.round(distanceKm * 1000);
    const toleranceM = vendor.tolerance_radius_m || 100;

    const userId = (await supabase.auth.getUser()).data.user?.id;

    // Log the check
    await supabase.from('vendor_location_logs').insert({
      vendor_id: vendorId,
      action,
      device_latitude: deviceLat,
      device_longitude: deviceLon,
      verified_latitude: vendor.verified_latitude,
      verified_longitude: vendor.verified_longitude,
      distance_m: distanceM,
      result: distanceM <= toleranceM ? 'passed' : 'failed',
      performed_by: userId || null,
    });

    if (distanceM > toleranceM) {
      // Auto-lock the store
      await supabase.from('vendors').update({
        geo_verification_status: 'locked_pending_reverify',
        geo_locked_at: new Date().toISOString(),
        geo_lock_reason: `Device location ${distanceM}m from verified location (tolerance: ${toleranceM}m) during ${action}`,
        is_open: false,
      }).eq('id', vendorId);

      toast({
        title: '🔒 Store Geo-Locked',
        description: `Your device is ${distanceM}m from your verified location. Store has been locked. Please submit a reverification request.`,
        variant: 'destructive',
      });

      // Send red flag notifications to admin and vendor
      try {
        // Get vendor name for notification context
        const { data: vendorInfo } = await supabase
          .from('vendors')
          .select('name, user_id')
          .eq('id', vendorId)
          .single();

        // Get all active admin user IDs
        const { data: admins } = await supabase
          .from('admin_staff')
          .select('user_id')
          .in('role', ['super_admin', 'admin'])
          .eq('is_active', true);

        const adminUserIds = admins?.map(a => a.user_id) || [];
        const vendorName = vendorInfo?.name || 'Unknown Vendor';
        const actionLabel = action === 'store_open_check' ? 'opening their store' : 'accepting an order';

        // Red flag notification to admins
        if (adminUserIds.length > 0) {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: adminUserIds,
              title: '🚩 RED FLAG: Geo-Lock Violation',
              body: `Vendor "${vendorName}" triggered a geo-lock violation while ${actionLabel}. Device was ${distanceM}m from verified location (tolerance: ${toleranceM}m). Store has been auto-locked.`,
              url: '/admin/vendors',
              data: { vendor_id: vendorId, distance_m: distanceM, action },
            },
          });
        }

        // Red flag notification to vendor owner
        if (vendorInfo?.user_id) {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: [vendorInfo.user_id],
              title: '🚩 Geo-Lock Violation Alert',
              body: `Your store "${vendorName}" has been locked. Your device was detected ${distanceM}m away from the verified location (allowed: ${toleranceM}m). This violation has been reported to the administration. Submit a reverification request to unlock your store.`,
              url: '/vendor/settings',
              data: { vendor_id: vendorId, distance_m: distanceM },
            },
          });
        }
      } catch (notifErr) {
        console.error('Failed to send geo-lock violation notifications:', notifErr);
      }

      return { passed: false, distanceM, locked: true };
    }

    return { passed: true, distanceM, locked: false };
  }, [toast]);

  return { checkGeoLock };
}
