// Custom service worker additions for push notifications
// This file is imported by the PWA plugin's service worker

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const { title, body, icon, badge, data: notifData } = data;
    // Only explicit, routed order/dispatch events carrying a stable id may ask
    // open windows to play the in-app order sound. Generic pushes (chat,
    // status, promotions, broadcasts) only show the OS notification.
    const eventId = notifData && (notifData.event_id || notifData.order_id || notifData.orderId || notifData.offer_id || notifData.offerId) || null;
    const ORDER_SOUND_TYPES = ['NEW_ORDER', 'DISPATCH_OFFER', 'RIDER_ASSIGNED'];
    let messageType = null;
    if (notifData?.type === 'CALL' && eventId) messageType = 'INCOMING_ORDER_CALL';
    else if (ORDER_SOUND_TYPES.includes(notifData?.type) && eventId) messageType = 'PLAY_NOTIFICATION_SOUND';

    event.waitUntil(
      self.registration.showNotification(title || 'Fast Calories', {
        body: body || '',
        icon: icon || '/images/fast-calories-logo.png',
        badge: badge || '/pwa-192x192.png',
        vibrate: [200, 100, 200, 100, 200],
        data: notifData || {},
        actions: notifData?.type === 'CALL'
          ? [{ action: 'accept', title: '✅ Pick Order' }, { action: 'dismiss', title: '❌ Dismiss' }]
          : (notifData?.actions || []),
        tag: notifData?.type === 'CALL' ? 'call_notification' : (notifData?.tag || eventId || 'default'),
        renotify: notifData?.type === 'CALL',
        silent: false,
        requireInteraction: true,
      }).then(() => {
        if (!messageType) return;
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
          clients.forEach(client => {
            client.postMessage({
              type: messageType,
              eventId,
              data: notifData,
            });
          });
        });
      })
    );
  } catch (e) {
    // Fallback for text payloads
    event.waitUntil(
      self.registration.showNotification('Fast Calories', {
        body: event.data.text(),
        icon: '/images/fast-calories-logo.png',
      })
    );
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const notifData = event.notification.data || {};
  let url = notifData.url || '/';
  if (notifData.type === 'CALL' && notifData.callId) {
    url = `/?call=${notifData.callId}`;
  }

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if available
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(url);
          return client.focus();
        }
      }
      // Open new window
      return self.clients.openWindow(url);
    })
  );
});
