import { useEffect, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

/**
 * Hook to register FCM tokens on native Capacitor Android/iOS.
 * Uses dynamic imports so it doesn't break on web.
 */
export function useFcmNotifications() {
  const { toast } = useToast();
  const [isNative, setIsNative] = useState(false);
  const [fcmToken, setFcmToken] = useState<string | null>(null);

  useEffect(() => {
    // Detect if running inside Capacitor native shell
    const checkNative = async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        const native = Capacitor.isNativePlatform();
        setIsNative(native);
        if (native) {
          registerFcmToken();
        }
      } catch {
        // Not in Capacitor environment
        setIsNative(false);
      }
    };
    checkNative();
  }, []);

  const registerFcmToken = useCallback(async () => {
    try {
      const { Capacitor } = await import('@capacitor/core');
      if (!Capacitor.isNativePlatform()) return;
      if (!Capacitor.isPluginAvailable('FirebaseMessaging')) {
        console.info('FirebaseMessaging plugin not available on this native build; skipping FCM registration.');
        return;
      }

      // Dynamically import Firebase messaging plugin
      const { FirebaseMessaging } = await import('@capacitor-firebase/messaging');

      // Request permission
      const permResult = await FirebaseMessaging.requestPermissions();
      if (permResult.receive !== 'granted') {
        console.log('FCM permission denied');
        return;
      }

      // Get FCM token
      const { token } = await FirebaseMessaging.getToken();
      if (!token) return;

      setFcmToken(token);

      // Save to database
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase
        .from('push_subscriptions')
        .upsert({
          user_id: user.id,
          endpoint: `fcm://${token.substring(0, 50)}`, // unique identifier
          p256dh: '',
          auth: '',
          fcm_token: token,
          subscription_type: 'fcm',
          user_agent: navigator.userAgent,
        }, {
          onConflict: 'user_id,endpoint,subscription_type',
        });

      console.log('FCM token registered successfully');

      // Listen for token refresh
      FirebaseMessaging.addListener('tokenReceived', async (newToken) => {
        setFcmToken(newToken.token);
        const { data: { user: currentUser } } = await supabase.auth.getUser();
        if (currentUser) {
          await supabase
            .from('push_subscriptions')
            .upsert({
              user_id: currentUser.id,
              endpoint: `fcm://${newToken.token.substring(0, 50)}`,
              p256dh: '',
              auth: '',
              fcm_token: newToken.token,
              subscription_type: 'fcm',
              user_agent: navigator.userAgent,
            }, {
              onConflict: 'user_id,endpoint,subscription_type',
            });
        }
      });

    } catch (error: any) {
      console.error('FCM registration error:', error);
    }
  }, []);

  return { isNative, fcmToken };
}
