// Custom service worker additions for push notifications
// This file is imported by the PWA plugin's service worker

self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const { title, body, icon, badge, data: notifData } = data;

    event.waitUntil(
      self.registration.showNotification(title || 'Fast Calories', {
        body: body || '',
        icon: icon || '/images/fast-calories-logo.png',
        badge: badge || '/pwa-192x192.png',
        vibrate: [200, 100, 200, 100, 200],
        data: notifData || {},
        actions: notifData?.actions || [],
        tag: notifData?.tag || 'default',
        renotify: true,
        silent: false,
        requireInteraction: true,
      }).then(() => {
        // Play notification sound by posting message to any open client
        return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
          clients.forEach(client => {
            client.postMessage({
              type: 'PLAY_NOTIFICATION_SOUND',
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

  const url = event.notification.data?.url || '/';

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
