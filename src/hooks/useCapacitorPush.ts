import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Hook to register Capacitor native push notifications (iOS/Android).
 * Creates notification channels with custom sound for vendor/rider order alerts.
 * Uses dynamic imports so it doesn't break on web.
 */
export function useCapacitorPush() {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const setup = async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;

        const { PushNotifications } = await import('@capacitor/push-notifications');

        // Create vendor orders channel with custom sound
        await PushNotifications.createChannel({
          id: 'vendor-orders',
          name: 'New Orders',
          description: 'Notifications with sound for new vendor orders',
          sound: 'order_sound',
          importance: 5,
          visibility: 1,
          vibration: true,
        });

        // Create rider orders channel with custom sound
        await PushNotifications.createChannel({
          id: 'rider-orders',
          name: 'Rider Dispatch',
          description: 'Notifications with sound for new rider dispatch offers',
          sound: 'order_sound',
          importance: 5,
          visibility: 1,
          vibration: true,
        });

        // Request permissions (Android 13+)
        let permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
          console.error('User denied push notification permissions.');
          return;
        }

        // Register with FCM
        await PushNotifications.register();

        // Handle token registration
        PushNotifications.addListener('registration', async (tokenData) => {
          console.log('Push token:', tokenData.value);
          setToken(tokenData.value);

          // Save token to database
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await supabase
              .from('push_subscriptions')
              .upsert({
                user_id: user.id,
                endpoint: `capacitor://${tokenData.value.substring(0, 50)}`,
                p256dh: '',
                auth: '',
                fcm_token: tokenData.value,
                subscription_type: 'fcm',
                user_agent: navigator.userAgent,
              }, {
                onConflict: 'user_id,endpoint,subscription_type',
              });
          }
        });

        PushNotifications.addListener('registrationError', (error) => {
          console.error('Push registration error:', error);
        });

        // Handle foreground notifications
        PushNotifications.addListener('pushNotificationReceived', (notification) => {
          console.log('Push received in foreground:', notification);
        });
      } catch {
        // Not in Capacitor environment
      }
    };

    setup();
  }, []);

  return { token };
}
