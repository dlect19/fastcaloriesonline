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
 * Hook for performing geo-lock checks on outlet actions.
 * Checks device GPS against verified outlet coordinates.
 * If distance exceeds tolerance, auto-locks the outlet.
 */
export function useGeoLockCheck() {
  const { toast } = useToast();

  const checkGeoLock = useCallback(async (
    outletId: string,
    action: 'store_open_check' | 'order_accept_check'
  ): Promise<GeoLockCheckResult> => {
    // Fetch outlet's verified location and tolerance
    const { data: outlet } = await supabase
      .from('vendor_outlets')
      .select('verified_latitude, verified_longitude, tolerance_radius_m, geo_verification_status, vendor_id')
      .eq('id', outletId)
      .single();

    if (!outlet) {
      return { passed: true, distanceM: 0, locked: false };
    }

    // If not verified yet, skip check
    if (!outlet.verified_latitude || !outlet.verified_longitude || outlet.geo_verification_status !== 'verified') {
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
      outlet.verified_latitude, outlet.verified_longitude
    );
    const distanceM = Math.round(distanceKm * 1000);
    const toleranceM = outlet.tolerance_radius_m || 500;

    const userId = (await supabase.auth.getUser()).data.user?.id;

    // Log the check
    await supabase.from('vendor_location_logs').insert({
      vendor_id: outlet.vendor_id,
      action,
      device_latitude: deviceLat,
      device_longitude: deviceLon,
      verified_latitude: outlet.verified_latitude,
      verified_longitude: outlet.verified_longitude,
      distance_m: distanceM,
      result: distanceM <= toleranceM ? 'passed' : 'failed',
      performed_by: userId || null,
    });

    if (distanceM > toleranceM) {
      // Auto-lock the outlet
      await supabase.from('vendor_outlets').update({
        geo_verification_status: 'locked_pending_reverify',
        geo_locked_at: new Date().toISOString(),
        geo_lock_reason: `Device location ${distanceM}m from verified location (tolerance: ${toleranceM}m) during ${action}`,
        is_open: false,
      }).eq('id', outletId);

      toast({
        title: '🔒 Outlet Geo-Locked',
        description: `Your device is ${distanceM}m from your verified location. Outlet has been locked. Please submit a reverification request.`,
        variant: 'destructive',
      });

      // Send red flag notifications to admin and vendor
      try {
        const { data: outletInfo } = await supabase
          .from('vendor_outlets')
          .select('outlet_name, vendor_id')
          .eq('id', outletId)
          .single();

        const { data: vendorInfo } = await supabase
          .from('vendors')
          .select('name, user_id')
          .eq('id', outlet.vendor_id)
          .single();

        const { data: admins } = await supabase
          .from('admin_staff')
          .select('user_id')
          .in('role', ['super_admin', 'admin'])
          .eq('is_active', true);

        const adminUserIds = admins?.map(a => a.user_id) || [];
        const outletName = outletInfo?.outlet_name || 'Unknown Outlet';
        const vendorName = vendorInfo?.name || 'Unknown Vendor';
        const actionLabel = action === 'store_open_check' ? 'opening the outlet' : 'accepting an order';

        if (adminUserIds.length > 0) {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: adminUserIds,
              title: '🚩 RED FLAG: Geo-Lock Violation',
              body: `Outlet "${outletName}" (${vendorName}) triggered a geo-lock violation while ${actionLabel}. Device was ${distanceM}m from verified location (tolerance: ${toleranceM}m). Outlet has been auto-locked.`,
              url: '/admin/vendors',
              data: { outlet_id: outletId, vendor_id: outlet.vendor_id, distance_m: distanceM, action },
            },
          });
        }

        if (vendorInfo?.user_id) {
          await supabase.functions.invoke('send-push-notification', {
            body: {
              user_ids: [vendorInfo.user_id],
              title: '🚩 Geo-Lock Violation Alert',
              body: `Your outlet "${outletName}" has been locked. Your device was detected ${distanceM}m away from the verified location (allowed: ${toleranceM}m). This violation has been reported to the administration. Submit a reverification request to unlock your outlet.`,
              url: '/vendor/settings',
              data: { outlet_id: outletId, distance_m: distanceM },
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
