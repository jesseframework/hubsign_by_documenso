import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { BellOff, BellRing, ShieldAlert, AlertTriangle } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { cn } from '@documenso/ui/lib/utils';
import { Alert, AlertDescription, AlertTitle } from '@documenso/ui/primitives/alert';
import { Button } from '@documenso/ui/primitives/button';
import { Switch } from '@documenso/ui/primitives/switch';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { useFirebasePush } from '~/utils/firebase-push';

type PreferenceKey =
  | 'documentSentToYou'
  | 'documentSigned'
  | 'documentCompleted'
  | 'documentRejected'
  | 'reminderReceived';

const preferenceRows: { key: PreferenceKey; title: React.ReactNode; description: React.ReactNode }[] = [
  {
    key: 'documentSentToYou',
    title: <Trans>Document sent to you</Trans>,
    description: <Trans>Someone sends you a document to sign.</Trans>,
  },
  {
    key: 'documentSigned',
    title: <Trans>Recipient signed</Trans>,
    description: <Trans>Someone signs a document you sent.</Trans>,
  },
  {
    key: 'documentCompleted',
    title: <Trans>Document completed</Trans>,
    description: <Trans>All recipients have signed and the document is final.</Trans>,
  },
  {
    key: 'documentRejected',
    title: <Trans>Document rejected</Trans>,
    description: <Trans>A recipient declined to sign a document you sent.</Trans>,
  },
  {
    key: 'reminderReceived',
    title: <Trans>Reminder received</Trans>,
    description: <Trans>A reminder email is sent to you about an unsigned document.</Trans>,
  },
];

export type PushNotificationPreferencesFormProps = {
  className?: string;
};

export const PushNotificationPreferencesForm = ({
  className,
}: PushNotificationPreferencesFormProps) => {
  const { _ } = useLingui();
  const { toast } = useToast();

  const { status, isRegistering, enablePush, isServerEnabled } = useFirebasePush();

  const prefsQuery = trpc.push.getPreferences.useQuery(undefined, {
    enabled: isServerEnabled,
  });
  const updatePrefs = trpc.push.updatePreferences.useMutation({
    onSuccess: () => prefsQuery.refetch(),
  });

  const onToggle = async (key: PreferenceKey, value: boolean) => {
    try {
      await updatePrefs.mutateAsync({ [key]: value });
    } catch {
      toast({
        title: _(msg`Couldn't update preference`),
        description: _(msg`Something went wrong. Please try again.`),
        variant: 'destructive',
      });
    }
  };

  // --- Server-side disabled: feature is dark for this deployment.
  if (status === 'server-disabled') {
    return (
      <Alert className={cn('max-w-xl', className)} variant="warning">
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>
          <Trans>Push notifications aren't configured</Trans>
        </AlertTitle>
        <AlertDescription>
          <Trans>
            Your administrator hasn't enabled push notifications for this deployment.
          </Trans>
        </AlertDescription>
      </Alert>
    );
  }

  // --- Browser or client config unavailable.
  if (status === 'unsupported' || status === 'unconfigured') {
    return (
      <Alert className={cn('max-w-xl', className)} variant="warning">
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>
          <Trans>Push notifications unavailable</Trans>
        </AlertTitle>
        <AlertDescription>
          {status === 'unsupported' ? (
            <Trans>This browser doesn't support push notifications.</Trans>
          ) : (
            <Trans>Firebase isn't configured on the client. Please contact your administrator.</Trans>
          )}
        </AlertDescription>
      </Alert>
    );
  }

  const prefs = prefsQuery.data;

  return (
    <div className={cn('flex w-full max-w-xl flex-col gap-6', className)}>
      <div className="rounded-[var(--r)] border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            {status === 'granted' ? (
              <BellRing className="text-primary mt-0.5 h-5 w-5 flex-shrink-0" />
            ) : (
              <BellOff className="text-muted-foreground mt-0.5 h-5 w-5 flex-shrink-0" />
            )}
            <div>
              <p className="text-sm font-medium">
                <Trans>Browser push notifications</Trans>
              </p>
              <p className="text-muted-foreground mt-1 text-sm">
                {status === 'granted' ? (
                  <Trans>This browser is registered to receive push notifications.</Trans>
                ) : status === 'denied' ? (
                  <Trans>
                    You've blocked notifications for this site. Re-enable them in your browser
                    settings and refresh.
                  </Trans>
                ) : status === 'error' ? (
                  <Trans>Something went wrong enabling notifications. Please try again.</Trans>
                ) : (
                  <Trans>Turn on browser notifications to start receiving pushes.</Trans>
                )}
              </p>
            </div>
          </div>

          {status !== 'granted' && status !== 'denied' && (
            <Button onClick={enablePush} loading={isRegistering} size="sm">
              <Trans>Enable</Trans>
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">
          <Trans>Notify me about</Trans>
        </h3>
        <p className="text-muted-foreground text-sm">
          <Trans>Choose which events should trigger a push notification.</Trans>
        </p>
      </div>

      <div className="divide-y divide-border rounded-[var(--r)] border border-border">
        {preferenceRows.map((row) => (
          <div
            key={row.key}
            className="flex items-center justify-between gap-4 px-4 py-3 first:rounded-t-[var(--r)] last:rounded-b-[var(--r)]"
          >
            <div className="min-w-0">
              <p className="text-sm font-medium">{row.title}</p>
              <p className="text-muted-foreground mt-0.5 text-sm">{row.description}</p>
            </div>
            <Switch
              checked={prefs?.[row.key] ?? true}
              disabled={!prefs || updatePrefs.isPending}
              onCheckedChange={(value) => onToggle(row.key, value)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
