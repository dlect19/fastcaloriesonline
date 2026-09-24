import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Hook to register Capacitor native push notifications (iOS/Android).
 * Creates notification channels with custom sound for vendor/rider order alerts.
 * Uses dynamic imports so it doesn't break on web.
 */
type ListenerHandle = { remove: () => Promise<void> | void };

// Process-wide registration: many screens call this hook, but native listeners
// are added once and removed when the last consumer unmounts.
let consumers = 0;
let handles: ListenerHandle[] = [];
let setupPromise: Promise<void> | null = null;
let currentToken: string | null = null;
const tokenSubscribers = new Set<(t: string | null) => void>();

async function teardown() {
  const toRemove = handles;
  handles = [];
  setupPromise = null;
  await Promise.allSettled(toRemove.map((h) => Promise.resolve(h.remove())));
}

/** Test helper. */
export function __getCapacitorPushState() {
  return { consumers, handleCount: handles.length };
}

export function useCapacitorPush() {
  const [token, setToken] = useState<string | null>(currentToken);

  useEffect(() => {
    consumers += 1;
    tokenSubscribers.add(setToken);
    if (!setupPromise) setupPromise = setup();
    return () => {
      consumers -= 1;
      tokenSubscribers.delete(setToken);
      if (consumers <= 0) {
        consumers = 0;
        const pending = setupPromise;
        Promise.resolve(pending).finally(() => { if (consumers === 0) teardown(); });
      }
    };
  }, []);

  return { token };
}

async function setup(): Promise<void> {
  {
    {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) return;
        const platform = Capacitor.getPlatform();

        const { PushNotifications } = await import('@capacitor/push-notifications');

        // Notification channels are Android-only.
        if (platform === 'android') {
          await PushNotifications.createChannel({
            id: 'order-calls-v6',
            name: 'Urgent Order Calls',
            description: 'Full-screen urgent alerts for new orders',
            sound: 'fastcaloriesvendor',
            importance: 5,
            visibility: 1,
            vibration: true,
          });

          await PushNotifications.createChannel({
            id: 'vendor-orders-v3',
            name: 'New Order Alerts',
            description: 'Urgent sound for new orders',
            sound: 'fastcaloriesvendor',
            importance: 5,
            visibility: 1,
            vibration: true,
          });

          await PushNotifications.createChannel({
            id: 'rider-orders',
            name: 'Rider Dispatch',
            description: 'Notifications for new rider dispatch offers',
            sound: 'fastcaloriesrider',
            importance: 5,
            visibility: 1,
            vibration: true,
          });
        }

        // Request permissions on supported native platforms.
        let permStatus = await PushNotifications.checkPermissions();
        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
          console.error('User denied push notification permissions.');
          return;
        }

        // Add listeners before registering so the token event is not missed.

        // Handle token registration
        handles.push(await PushNotifications.addListener('registration', async (tokenData) => {
          currentToken = tokenData.value;
          tokenSubscribers.forEach((fn) => fn(tokenData.value));

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
        }));

        handles.push(await PushNotifications.addListener('registrationError', (error) => {
          console.error('Push registration error:', error);
        }));

        // Foreground receipt never plays audio here; order sound is owned by
        // the deduped portal listeners.
        handles.push(await PushNotifications.addListener('pushNotificationReceived', () => {}));

        // Tap / action: navigation only, never audio.
        handles.push(await PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
          const data = action.notification.data;
          console.log('Push action performed:', data);
          if (data?.type === 'CALL' && data?.callId) {
            window.location.href = `/?call=${data.callId}`;
          } else if (data?.type === 'CALL' && data?.orderId) {
            window.location.href = '/vendor/orders';
          } else if (data?.url) {
            window.location.href = data.url;
          }
        }));

        await PushNotifications.register();
      } catch {
        // Not in Capacitor environment
      }
  }
  }
}
