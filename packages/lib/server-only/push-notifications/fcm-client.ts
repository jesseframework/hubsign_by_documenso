import { env } from '../../utils/env';

/**
 * Firebase Cloud Messaging (FCM) HTTP v1 API client.
 *
 * Required env vars:
 * - NEXT_PRIVATE_FCM_PROJECT_ID — Firebase project id (e.g. "hubsign-prod")
 * - NEXT_PRIVATE_FCM_SERVICE_ACCOUNT_JSON — Base64-encoded service-account key JSON
 *   (download from Firebase console → Project settings → Service accounts → Generate new private key,
 *    then `base64 -i serviceAccountKey.json`)
 *
 * If env vars are not set, push sends are silently skipped (no-op) so the
 * feature can ship dark and be enabled per-deployment.
 */

export type FcmMessage = {
  token: string;
  notification: {
    title: string;
    body: string;
  };
  /** Click target — used by the web SDK to open a URL when notification is clicked. */
  webpushFcmOptions?: { link?: string };
  data?: Record<string, string>;
};

export const isFcmConfigured = (): boolean => {
  return Boolean(env('NEXT_PRIVATE_FCM_PROJECT_ID') && env('NEXT_PRIVATE_FCM_SERVICE_ACCOUNT_JSON'));
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/**
 * Get an OAuth access token for the FCM v1 API by signing a JWT with the
 * service account key. Tokens are cached for 55 minutes (Google issues 60-min tokens).
 */
const getAccessToken = async (): Promise<string> => {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }

  const sa = JSON.parse(
    Buffer.from(env('NEXT_PRIVATE_FCM_SERVICE_ACCOUNT_JSON') ?? '', 'base64').toString('utf-8'),
  ) as { client_email: string; private_key: string; token_uri: string };

  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: sa.token_uri,
    exp: now + 3600,
    iat: now,
  };

  const header = { alg: 'RS256', typ: 'JWT' };
  const enc = (obj: object) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const unsigned = `${enc(header)}.${enc(claims)}`;

  const crypto = await import('node:crypto');
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsigned);
  const signature = signer
    .sign(sa.private_key)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `${unsigned}.${signature}`;

  const tokenRes = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });

  if (!tokenRes.ok) {
    throw new Error(`FCM token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`);
  }

  const { access_token, expires_in } = (await tokenRes.json()) as {
    access_token: string;
    expires_in: number;
  };

  cachedAccessToken = {
    token: access_token,
    expiresAt: Date.now() + Math.max(0, (expires_in - 300)) * 1000,
  };

  return access_token;
};

/**
 * Send a single FCM notification. Resolves with the FCM message id on success.
 * Returns null (and logs) if FCM isn't configured or the send fails — push
 * notifications are best-effort by design.
 */
export const sendFcmNotification = async (message: FcmMessage): Promise<string | null> => {
  if (!isFcmConfigured()) return null;

  try {
    const accessToken = await getAccessToken();
    const projectId = env('NEXT_PRIVATE_FCM_PROJECT_ID');

    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: message.token,
            notification: message.notification,
            webpush: message.webpushFcmOptions
              ? { fcm_options: message.webpushFcmOptions }
              : undefined,
            data: message.data,
          },
        }),
      },
    );

    if (!res.ok) {
      console.error('[fcm] send failed:', res.status, await res.text());
      return null;
    }

    const json = (await res.json()) as { name?: string };
    return json.name ?? null;
  } catch (err) {
    console.error('[fcm] send threw:', err);
    return null;
  }
};

/**
 * Send the same notification to all of a user's registered devices.
 * Returns the count of successful sends. Stale tokens (404 NOT_REGISTERED)
 * should ideally be cleaned up — TODO follow-up.
 */
export const sendFcmNotificationToUser = async (
  userId: number,
  notification: { title: string; body: string; link?: string; data?: Record<string, string> },
): Promise<number> => {
  if (!isFcmConfigured()) return 0;

  const { prisma } = await import('@documenso/prisma');
  const tokens = await prisma.pushDeviceToken.findMany({
    where: { userId },
    select: { token: true },
  });

  let sent = 0;
  for (const { token } of tokens) {
    const id = await sendFcmNotification({
      token,
      notification: { title: notification.title, body: notification.body },
      webpushFcmOptions: notification.link ? { link: notification.link } : undefined,
      data: notification.data,
    });
    if (id) sent += 1;
  }

  return sent;
};
