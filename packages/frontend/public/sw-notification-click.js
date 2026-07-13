/**
 * Service-worker notification click handler.
 *
 * Imported into the generated Workbox service worker via
 * `workbox.importScripts` (see vite.config.ts). Notifications shown with
 * ServiceWorkerRegistration.showNotification() have no page-side onclick;
 * without this listener, tapping a notification does nothing.
 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        const target = new URL(targetUrl, self.location.origin).href;
        const matchingClient = clientList.find((client) => client.url === target);
        if (matchingClient && 'focus' in matchingClient) {
          return matchingClient.focus();
        }
        if (self.clients.openWindow) {
          return self.clients.openWindow(target);
        }
        return undefined;
      }),
  );
});
