import { useCallback, useEffect, useRef, useState } from 'react';

import { env } from '@documenso/lib/utils/env';
import { trpc } from '@documenso/trpc/react';

const SW_PATH = '/firebase-messaging-sw.js';

export type PushStatus =
  | 'unsupported' // browser has no Notification / service worker API
  | 'unconfigured' // env vars missing on client
  | 'server-disabled' // FCM not configured on the backend
  | 'default' // user hasn't been asked yet
  | 'denied' // user denied the permission prompt
  | 'granted' // permission granted and token registered
  | 'error'; // something went wrong during setup

type FirebaseClientConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  vapidKey: string;
};

const readClientConfig = (): FirebaseClientConfig | null => {
  const apiKey = env('NEXT_PUBLIC_FIREBASE_API_KEY');
  const authDomain = env('NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN');
  const projectId = env('NEXT_PUBLIC_FIREBASE_PROJECT_ID');
  const storageBucket = env('NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET');
  const messagingSenderId = env('NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID');
  const appId = env('NEXT_PUBLIC_FIREBASE_APP_ID');
  const vapidKey = env('NEXT_PUBLIC_FIREBASE_VAPID_KEY');

  if (!apiKey || !authDomain || !projectId || !messagingSenderId || !appId || !vapidKey) {
    return null;
  }

  return {
    apiKey,
    authDomain,
    projectId,
    storageBucket: storageBucket ?? '',
    messagingSenderId,
    appId,
    vapidKey,
  };
};

const isBrowserSupported = () =>
  typeof window !== 'undefined' &&
  typeof navigator !== 'undefined' &&
  'serviceWorker' in navigator &&
  'Notification' in window &&
  'PushManager' in window;

/**
 * Register the FCM service worker. The worker itself is served dynamically by
 * `app/routes/firebase-messaging-sw[.js].ts`, which inlines the Firebase
 * config from env vars — so we don't need to pass anything on the query string.
 */
const registerServiceWorker = async () => {
  return navigator.serviceWorker.register(SW_PATH, { scope: '/' });
};

const getFcmToken = async (config: FirebaseClientConfig): Promise<string | null> => {
  const [{ initializeApp, getApps, getApp }, { getMessaging, getToken, onMessage, isSupported }] =
    await Promise.all([import('firebase/app'), import('firebase/messaging')]);

  if (!(await isSupported())) return null;

  const app = getApps().length ? getApp() : initializeApp(config);
  const messaging = getMessaging(app);
  const swRegistration = await registerServiceWorker();

  const token = await getToken(messaging, {
    vapidKey: config.vapidKey,
    serviceWorkerRegistration: swRegistration,
  });

  // Also surface foreground messages as native notifications (FCM only invokes
  // the SW's onBackgroundMessage when the tab is not focused).
  onMessage(messaging, (payload) => {
    const title = payload.notification?.title ?? 'HubSign';
    const body = payload.notification?.body ?? '';
    if (Notification.permission === 'granted') {
      new Notification(title, {
        body,
        icon: '/android-chrome-192x192.png',
        data: payload.data,
      });
    }
  });

  return token;
};

/**
 * React hook that manages FCM setup for the current user. Call `enablePush()`
 * from a user gesture (e.g. a button click) — browsers block permission prompts
 * outside user interaction. When permission is already granted this hook will
 * silently refresh the device token on mount so rotated tokens stay in sync.
 */
export const useFirebasePush = () => {
  const [status, setStatus] = useState<PushStatus>('default');
  const [isRegistering, setIsRegistering] = useState(false);

  const config = useRef<FirebaseClientConfig | null>(null);
  if (config.current === null && typeof window !== 'undefined') {
    config.current = readClientConfig();
  }

  const serverEnabledQuery = trpc.push.isEnabled.useQuery(undefined, {
    staleTime: 5 * 60 * 1000,
  });
  const registerDeviceMutation = trpc.push.registerDevice.useMutation();

  // Compute initial status once we know browser + server + env state.
  useEffect(() => {
    if (!isBrowserSupported()) {
      setStatus('unsupported');
      return;
    }
    if (!config.current) {
      setStatus('unconfigured');
      return;
    }
    if (serverEnabledQuery.data && serverEnabledQuery.data.enabled === false) {
      setStatus('server-disabled');
      return;
    }
    if (Notification.permission === 'denied') setStatus('denied');
    else if (Notification.permission === 'granted') setStatus('granted');
    else setStatus('default');
  }, [serverEnabledQuery.data]);

  // When the browser already has permission, silently refresh and sync the
  // token on mount so the backend always has an up-to-date registration.
  useEffect(() => {
    if (status !== 'granted' || !config.current) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getFcmToken(config.current!);
        if (!cancelled && token) {
          await registerDeviceMutation.mutateAsync({ token, platform: 'web' });
        }
      } catch (err) {
        console.error('[push] silent token refresh failed:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Only run once per mount — the mutation is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const enablePush = useCallback(async () => {
    if (!isBrowserSupported() || !config.current) return;
    setIsRegistering(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'default');
        return;
      }
      const token = await getFcmToken(config.current);
      if (!token) {
        setStatus('error');
        return;
      }
      await registerDeviceMutation.mutateAsync({ token, platform: 'web' });
      setStatus('granted');
    } catch (err) {
      console.error('[push] enablePush failed:', err);
      setStatus('error');
    } finally {
      setIsRegistering(false);
    }
  }, [registerDeviceMutation]);

  return {
    status,
    isRegistering,
    enablePush,
    isServerEnabled: serverEnabledQuery.data?.enabled ?? false,
  };
};
