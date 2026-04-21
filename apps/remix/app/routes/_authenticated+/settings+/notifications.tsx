import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';

import { PushNotificationPreferencesForm } from '~/components/forms/push-notification-preferences';
import { SettingsHeader } from '~/components/general/settings-header';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Notifications');
}

export default function SettingsNotifications() {
  const { _ } = useLingui();

  return (
    <div>
      <SettingsHeader
        title={_(msg`Notifications`)}
        subtitle={_(msg`Manage browser push notifications for document events.`)}
      />

      <PushNotificationPreferencesForm />
    </div>
  );
}
