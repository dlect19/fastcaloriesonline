import { useCallback, useEffect, useState } from 'react';
import { BellOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { usePushNotifications } from '@/hooks/usePushNotifications';
import { riderNotificationStatus, type PermissionState } from '@/lib/riderNotificationStatus';

/**
 * Non-blocking banner shown when this rider's device cannot receive delivery
 * request notifications. It never asks for permission on its own — only when
 * the rider taps "Enable Notifications".
 */
export function RiderNotificationWarning({ userId }: { userId: string | null }) {
  const web = usePushNotifications();
  const [isNative, setIsNative] = useState<boolean | null>(null);
  const [permission, setPermission] = useState<PermissionState>('unknown');
  const [hasSub, setHasSub] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) return;
    let native = false;
    try {
      const { Capacitor } = await import('@capacitor/core');
      native = Capacitor.isNativePlatform() && Capacitor.isPluginAvailable('FirebaseMessaging');
    } catch {
      native = false;
    }
    setIsNative(native);
    if (native) {
      try {
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
        const p = await FirebaseMessaging.checkPermissions();
        setPermission(p.receive as PermissionState);
      } catch {
        setPermission('unknown');
      }
    } else if (typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator) {
      setPermission(Notification.permission as PermissionState);
    } else {
      setPermission('unsupported');
    }
    const { data } = await supabase
      .from('push_subscriptions')
      .select('id, subscription_type')
      .eq('user_id', userId)
      .limit(5);
    const rows = data || [];
    setHasSub(native ? rows.some((r) => r.subscription_type === 'fcm') : rows.length > 0);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh, web.isSubscribed]);

  const enable = useCallback(async () => {
    if (!userId || busy) return;
    setBusy(true);
    try {
      if (isNative) {
        const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');
        const perm = await FirebaseMessaging.requestPermissions();
        if (perm.receive === 'granted') {
          const { token } = await FirebaseMessaging.getToken();
          if (token) {
            await supabase.from('push_subscriptions').upsert(
              {
                user_id: userId,
                endpoint: `fcm://${token.substring(0, 50)}`,
                p256dh: '',
                auth: '',
                fcm_token: token,
                subscription_type: 'fcm',
                user_agent: navigator.userAgent,
              },
              { onConflict: 'user_id,endpoint,subscription_type' },
            );
          }
        }
      } else {
        await web.subscribe();
      }
    } catch (e) {
      console.error('Enable notifications failed:', e);
    } finally {
      setBusy(false);
      void refresh();
    }
  }, [userId, busy, isNative, web, refresh]);

  const status = riderNotificationStatus({ permission, hasServerSubscription: hasSub });
  if (!userId || dismissed || status === 'ok' || status === 'checking') return null;

  return (
    <div role="alert" className="mb-4 flex flex-col gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm sm:flex-row sm:items-center">
      <BellOff className="h-5 w-5 shrink-0 text-destructive" />
      <div className="flex-1">
        <p className="font-semibold text-foreground">Notifications are off on this device</p>
        <p className="text-muted-foreground">
          {status === 'blocked'
            ? 'Notifications are blocked. Allow them for FastCalories in your phone or browser settings, or you may miss delivery requests.'
            : status === 'unsupported'
              ? 'This browser cannot receive delivery alerts. Install the rider app or keep this page open.'
              : 'You may miss delivery requests when the app is closed.'}
        </p>
      </div>
      <div className="flex gap-2">
        {status === 'off' && (
          <Button size="sm" onClick={enable} disabled={busy}>
            {busy ? 'Enabling…' : 'Enable Notifications'}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Later
        </Button>
      </div>
    </div>
  );
}
