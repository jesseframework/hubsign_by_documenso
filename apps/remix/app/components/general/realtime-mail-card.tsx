import { useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';
import { AlertTriangleIcon, CheckCircle2Icon, ExternalLinkIcon, ZapIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

/**
 * Realtime inbound mail — WorkHub pushes instead of HubSign polling.
 *
 * Setup is three steps and two of them happen outside this app, so the card is
 * built as a checklist rather than a switch. The failure it exists to prevent is
 * a watch registered without the signing secret ever being copied out of the
 * Svix portal: verification then fails closed on every delivery, and from the
 * outside that is indistinguishable from the feature simply not working.
 */
export const RealtimeMailCard = () => {
  const { toast } = useToast();
  const { t } = useLingui();
  const utils = trpc.useUtils();

  const [secret, setSecret] = useState('');
  const [portalUrl, setPortalUrl] = useState<string | null>(null);

  const { data: status } = trpc.inbox.realtimeMailStatus.useQuery();

  /*
    Fetched separately and only once registered. The signing secret lives solely
    inside the portal, so an admin who reloads before finishing setup needs a way
    back in — the link from the registration response alone would strand them.
  */
  const { data: portal } = trpc.inbox.realtimeMailPortal.useQuery(undefined, {
    enabled: Boolean(status?.registered && status?.isAdmin),
    staleTime: 5 * 60 * 1000,
  });

  const enable = trpc.inbox.enableRealtimeMail.useMutation({
    onSuccess: (result) => {
      setPortalUrl(result.portalUrl);
      toast({
        title: t`Mailbox registered`,
        description: t`Now open the portal, add the endpoint, and paste the signing secret below.`,
      });
      void utils.inbox.realtimeMailStatus.invalidate();
    },
    onError: (err) => {
      toast({ title: t`Could not register`, description: err.message, variant: 'destructive' });
    },
  });

  const saveSecret = trpc.inbox.setRealtimeMailSecret.useMutation({
    onSuccess: (result) => {
      toast({
        title: result.hasSecret ? t`Realtime mail is on` : t`Signing secret cleared`,
      });
      setSecret('');
      void utils.inbox.realtimeMailStatus.invalidate();
    },
    onError: (err) => {
      toast({ title: t`Could not save`, description: err.message, variant: 'destructive' });
    },
  });

  if (!status) return null;

  const live = status.registered && status.hasSecret && status.deliverable;

  return (
    <div className="border-border mt-4 border-t pt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="flex items-center gap-1.5 text-[13px] font-semibold">
            <ZapIcon className="h-3.5 w-3.5" />
            <Trans>Realtime mail delivery</Trans>
          </h3>
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            <Trans>
              WorkHub notifies HubSign the moment mail arrives, instead of HubSign checking every
              two minutes. This also stops the checks counting against your mailbox quota.
            </Trans>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {live ? (
            <CheckCircle2Icon className="h-4 w-4 text-emerald-600" />
          ) : (
            <span className="bg-muted-foreground/40 inline-block h-2.5 w-2.5 rounded-full" />
          )}
          <span className="text-[12px] font-medium">
            {live ? <Trans>On</Trans> : <Trans>Off</Trans>}
          </span>
        </div>
      </div>

      {!status.deliverable && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div className="text-[12px]">
            <p className="font-medium">
              <Trans>This deployment cannot receive notifications yet.</Trans>
            </p>
            <p className="text-muted-foreground mt-0.5">
              <Trans>
                Notifications are delivered over the public internet, so HubSign needs a public
                address. It is currently running on a local one. Everything below can be set up now
                and will start working once it is deployed.
              </Trans>
            </p>
          </div>
        </div>
      )}

      <ol className="mt-3 space-y-3">
        <Step
          n={1}
          done={status.registered}
          title={<Trans>Register the mailbox with WorkHub</Trans>}
        >
          {status.registered ? (
            <p className="text-muted-foreground text-[11px]">
              <Trans>Registered. Re-run this if you ever change the mailbox.</Trans>
            </p>
          ) : (
            <p className="text-muted-foreground text-[11px]">
              <Trans>
                Needs the API key above to carry the "email.update" permission, and the mailbox to
                have a Proxy Profile linked in WorkHub.
              </Trans>
            </p>
          )}
          <Button
            size="sm"
            variant={status.registered ? 'outline' : 'default'}
            className="mt-2"
            loading={enable.isPending}
            disabled={!status.canRegister || !status.isAdmin}
            onClick={() => enable.mutate()}
          >
            {status.registered ? <Trans>Re-register</Trans> : <Trans>Register mailbox</Trans>}
          </Button>
        </Step>

        <Step n={2} done={false} title={<Trans>Add this address in the delivery portal</Trans>}>
          <p className="text-muted-foreground text-[11px]">
            {/*
              Said explicitly because it is not guessable: WorkHub hands delivery
              to Svix, and the portal is a separate hosted page. Looking for a
              webhooks screen in the WorkHub dashboard finds nothing.
            */}
            <Trans>
              This opens a separate delivery portal — it is not part of the WorkHub dashboard, so
              you can only reach it through this link. Add the address below as an endpoint,
              subscribe it to "email.mail-received", then copy the signing secret it shows you.
            </Trans>
          </p>
          {status.endpointUrl && (
            <code className="bg-muted mt-1.5 block break-all rounded px-2 py-1 font-mono text-[11px]">
              {status.endpointUrl}
            </code>
          )}

          {(portalUrl ?? portal?.portalUrl) ? (
            <a
              href={portalUrl ?? portal?.portalUrl ?? undefined}
              target="_blank"
              rel="noreferrer noopener"
              className="text-primary mt-2 inline-flex items-center gap-1 text-[11px] font-medium hover:underline"
            >
              <Trans>Open the delivery portal</Trans>
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
          ) : status.registered ? (
            <p className="text-muted-foreground mt-2 text-[11px]">
              <Trans>
                Could not fetch the portal link just now. Use "Re-register" above to get a fresh
                one.
              </Trans>
            </p>
          ) : null}
        </Step>

        <Step n={3} done={status.hasSecret} title={<Trans>Paste the signing secret</Trans>}>
          <p className="text-muted-foreground text-[11px]">
            <Trans>
              This is how HubSign proves a notification really came from WorkHub. Without it every
              notification is refused.
            </Trans>
          </p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={status.hasSecret ? '•••••••• (saved)' : 'whsec_...'}
              className="font-mono text-[12px]"
              autoComplete="off"
              spellCheck={false}
              disabled={!status.isAdmin || saveSecret.isPending}
            />
            <Button
              size="sm"
              loading={saveSecret.isPending}
              disabled={!secret.trim() || !status.isAdmin}
              onClick={() => saveSecret.mutate({ secret: secret.trim() })}
            >
              <Trans>Save</Trans>
            </Button>
            {status.hasSecret && (
              <Button
                size="sm"
                variant="ghost"
                disabled={!status.isAdmin}
                onClick={() => saveSecret.mutate({ secret: null })}
              >
                <Trans>Clear</Trans>
              </Button>
            )}
          </div>
        </Step>
      </ol>

      <p className="text-muted-foreground mt-3 text-[11px]">
        {/*
          Said plainly because the instinct after turning this on is to switch the
          timer off. Delivery is at-least-once and WorkHub documents a case where
          a large backlog can gap, so the timer stays as the safety net.
        */}
        <Trans>
          The regular check keeps running at a slower pace as a safety net, so nothing is missed if
          a notification is ever dropped.
        </Trans>
      </p>
    </div>
  );
};

const Step = ({
  n,
  done,
  title,
  children,
}: {
  n: number;
  done: boolean;
  title: React.ReactNode;
  children: React.ReactNode;
}) => (
  <li className="flex gap-2.5">
    <span
      className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
        done ? 'bg-emerald-600 text-white' : 'bg-muted text-muted-foreground'
      }`}
    >
      {done ? '✓' : n}
    </span>
    <div className="min-w-0 flex-1">
      <p className="text-[12px] font-medium">{title}</p>
      {children}
    </div>
  </li>
);
