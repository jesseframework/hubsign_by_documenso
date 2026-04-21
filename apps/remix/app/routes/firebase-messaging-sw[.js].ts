import { env } from '@documenso/lib/utils/env';

/**
 * Serves the Firebase Cloud Messaging service worker with the Firebase config
 * baked into the response body. Routing this through the app (instead of a
 * static file in `public/`) lets us inline the per-environment config from
 * env vars without the client having to pass it via query string — query
 * strings break React Router's dev static handler and drift across deployments.
 */
export async function loader() {
  const config = {
    apiKey: env('NEXT_PUBLIC_FIREBASE_API_KEY') ?? '',
    authDomain: env('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN') ?? '',
    projectId: env('NEXT_PUBLIC_FIREBASE_PROJECT_ID') ?? '',
    storageBucket: env('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET') ?? '',
    messagingSenderId: env('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID') ?? '',
    appId: env('NEXT_PUBLIC_FIREBASE_APP_ID') ?? '',
  };

  const body = `/* eslint-disable */
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const firebaseConfig = ${JSON.stringify(config)};

if (firebaseConfig.apiKey && firebaseConfig.projectId) {
  firebase.initializeApp(firebaseConfig);

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage((payload) => {
    const title = payload.notification?.title ?? 'HubSign';
    const options = {
      body: payload.notification?.body ?? '',
      icon: '/android-chrome-192x192.png',
      badge: '/favicon-32x32.png',
      data: payload.data ?? {},
    };
    self.registration.showNotification(title, options);
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = event.notification?.data?.link;
  if (!link) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === link && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    }),
  );
});
`;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Service-Worker-Allowed': '/',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
