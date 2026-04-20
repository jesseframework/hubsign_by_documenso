# Push Notifications (Firebase Cloud Messaging)

Server-side scaffold for FCM push notifications. **Disabled by default** — sends are no-ops until env vars are set.

## Setup

1. Create a Firebase project at https://console.firebase.google.com/
2. Enable Cloud Messaging
3. Project Settings → Service accounts → "Generate new private key" → downloads a JSON file
4. Base64-encode the JSON and set the env var:
   ```bash
   base64 -i serviceAccountKey.json
   ```
5. Add to your env (production + UAT):
   ```bash
   NEXT_PRIVATE_FCM_PROJECT_ID="your-firebase-project-id"
   NEXT_PRIVATE_FCM_SERVICE_ACCOUNT_JSON="<the base64 string from step 4>"
   ```

That's it server-side. `isFcmConfigured()` returns true and `sendFcmNotificationToUser()` actually sends.

## Wired event triggers

- ✅ `send-signing-email` — pushes "Please sign X" when the recipient is a HubSign user with the preference on
- ⏳ TODO — wire `send-recipient-signed-email`, `send-completed-email`, rejection, reminder

To wire more events, import and call inside the relevant job handler:
```ts
import { sendFcmNotificationToUser } from '@documenso/lib/server-only/push-notifications/fcm-client';

await sendFcmNotificationToUser(userId, {
  title: '…',
  body: '…',
  link: 'https://…',
});
```

## Client side (web)

Not yet built — needs:

1. `npm install firebase` in `apps/remix`
2. Service worker at `apps/remix/public/firebase-messaging-sw.js`
3. Init code in the app shell that:
   - Calls `getToken()` from the firebase-messaging SDK
   - Sends the token to `trpc.push.registerDevice.mutate({ token, platform: 'web' })`
4. UI on the user settings page calling `trpc.push.getPreferences/updatePreferences`

The server-side routes (`trpc.push.*`) are ready and waiting.
