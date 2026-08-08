import { useEffect, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { Bell, X } from 'lucide-react';

import { ONE_WEEK } from '@documenso/lib/constants/time';
import { Button } from '@documenso/ui/primitives/button';

import { useFirebasePush } from '~/utils/firebase-push';

const DISMISSED_AT_STORAGE_KEY = 'pushNotificationBannerDismissedAt';

/**
 * Proactively prompts authenticated users to turn on browser push
 * notifications, instead of relying on them to find the toggle buried in
 * Settings. Only renders when the browser/server support push and the user
 * hasn't been asked yet (status `default`) — it stays out of the way once
 * they've granted, denied, or recently dismissed it.
 */
export const PushNotificationBanner = () => {
  const { status, isRegistering, enablePush } = useFirebasePush();
  const [isDismissed, setIsDismissed] = useState(true);

  useEffect(() => {
    const dismissedAt = localStorage.getItem(DISMISSED_AT_STORAGE_KEY);

    if (!dismissedAt || Date.now() - parseInt(dismissedAt) > ONE_WEEK) {
      setIsDismissed(false);
    }
  }, []);

  const onDismiss = () => {
    localStorage.setItem(DISMISSED_AT_STORAGE_KEY, Date.now().toString());
    setIsDismissed(true);
  };

  const onEnable = async () => {
    await enablePush();
    onDismiss();
  };

  if (status !== 'default' || isDismissed) {
    return null;
  }

  return (
    <div className="bg-primary/10">
      <div className="mx-auto flex max-w-screen-xl items-center justify-center gap-x-4 px-4 py-2 text-sm font-medium">
        <div className="text-primary flex items-center">
          <Bell className="mr-2.5 h-5 w-5 flex-shrink-0" />
          <Trans>Turn on notifications for HubSign so you don't miss a document to sign.</Trans>
        </div>

        <div className="flex items-center gap-x-1">
          <Button
            variant="ghost"
            className="text-primary hover:bg-primary/10 h-auto px-2.5 py-1.5"
            loading={isRegistering}
            onClick={onEnable}
            size="sm"
          >
            <Trans>Enable</Trans>
          </Button>

          <Button
            variant="ghost"
            className="text-muted-foreground h-auto px-2 py-1.5"
            onClick={onDismiss}
            size="sm"
          >
            <X className="h-4 w-4" />
            <span className="sr-only">
              <Trans>Dismiss</Trans>
            </span>
          </Button>
        </div>
      </div>
    </div>
  );
};
