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

- ✅ `send-signing-email` — pushes "Please sign X" to the recipient
- ✅ `send-recipient-signed-email` — pushes to the document owner when a recipient signs
- ✅ `send-completed-email` — pushes to owner + all HubSign-user recipients when the document finalizes
- ✅ `send-rejection-emails` — pushes to the owner when a recipient rejects
- ⏳ `reminderReceived` preference exists but the reminder feature itself isn't built yet (backlog #4)

To wire more events, import and call inside the relevant job handler:
```ts
import { sendFcmNotificationToUser } from '@documenso/lib/server-only/push-notifications/fcm-client';

// Respect user prefs — read PushNotificationPreference by userId first, skip
// the send if the relevant flag is explicitly false.
await sendFcmNotificationToUser(userId, {
  title: '…',
  body: '…',
  link: 'https://…',
});
```

All event wiring is no-op when `isFcmConfigured()` returns false, so pushing to
a deployment without env vars set is safe.

## Client side (web)

Wired in `apps/remix`:

- `firebase` web SDK installed
- Service worker: `apps/remix/public/firebase-messaging-sw.js` (reads config from URL query params)
- Hook: `apps/remix/app/utils/firebase-push.ts` — `useFirebasePush()` returns `{ status, enablePush }`
- `<PushAutoSync />` mounted in the authenticated layout keeps tokens fresh on every page load
- Settings page: `/settings/notifications` with opt-in button + per-event toggles

Required client env vars (all `NEXT_PUBLIC_*` — see `.env.example` for the list).
