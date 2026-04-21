import { useFirebasePush } from '~/utils/firebase-push';

/**
 * Hidden component that keeps the current user's FCM device token in sync on
 * every authenticated page load. Does nothing if the browser hasn't granted
 * notification permission — the user must first opt in from settings.
 */
export const PushAutoSync = () => {
  useFirebasePush();
  return null;
};
