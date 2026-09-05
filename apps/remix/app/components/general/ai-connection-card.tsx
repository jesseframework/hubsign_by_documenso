import { useState } from 'react';

import { Trans, useLingui } from '@lingui/react/macro';
import { CheckCircle2Icon, PlugZapIcon, AlertTriangleIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { Card, CardContent, CardTitle } from '@documenso/ui/primitives/card';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

/**
 * The organization's AI connection — the `whk_` key that authorizes every AI
 * call it makes (Aubrey, workflow generation, DMS chat, AI stamps).
 *
 * Configured here rather than in the deployment environment for two reasons:
 * WorkHub attributes usage by credential, so one key per organization is what
 * makes their per-org reporting work; and an admin can rotate or revoke their
 * own AI access without anyone touching a server.
 *
 * The key is never read back. Once saved, only its last four characters are
 * shown — enough to identify which credential is installed, not enough to
 * recover it from a screenshot or a cached response.
 */
export const AiConnectionCard = () => {
  const { toast } = useToast();
  const { t } = useLingui();
  const utils = trpc.useUtils();

  const [key, setKey] = useState('');
  const [replacing, setReplacing] = useState(false);

  const { data: connection } = trpc.aubrey.getAiConnection.useQuery();

  const test = trpc.aubrey.testAiConnection.useMutation();

  const save = trpc.aubrey.setAiConnection.useMutation({
    onSuccess: (result) => {
      toast({
        title: result.configured ? t`AI connected` : t`AI disconnected`,
        description: result.configured
          ? t`AI features are now available to everyone in this organization.`
          : t`AI features are switched off for this organization.`,
      });
      setKey('');
      setReplacing(false);
      test.reset(); // a new key makes the previous verdict meaningless
      void utils.aubrey.getAiConnection.invalidate();
      void utils.aubrey.getUsage.invalidate();
    },
    onError: (err) => {
      toast({ title: t`Could not save`, description: err.message, variant: 'destructive' });
    },
  });

  if (!connection) return null;

  const { configured, hint, isAdmin, endpointReady } = connection;

  if (!isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-center gap-3 p-6">
          <StatusDot state={configured ? 'saved' : 'none'} />
          <p className="text-[13px]">
            {configured ? (
              <Trans>AI is set up for this organization.</Trans>
            ) : (
              <Trans>AI is not set up yet. An organization admin can configure it.</Trans>
            )}
          </p>
        </CardContent>
      </Card>
    );
  }

  /*
    A saved key is not a working key — the first key we were issued was missing
    its permission and every AI call 403'd while this card read green. So the
    status only claims "Working" once a live test has actually succeeded.
  */
  const state: DotState = !configured
    ? 'none'
    : test.data?.ok === true
      ? 'working'
      : test.data?.ok === false
        ? 'failing'
        : 'saved';

  const label = {
    none: <Trans>Not set up</Trans>,
    saved: <Trans>Key saved — untested</Trans>,
    working: <Trans>Working</Trans>,
    failing: <Trans>Not working</Trans>,
  }[state];

  const showInput = !configured || replacing;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>
              <Trans>AI connection</Trans>
            </CardTitle>
            <p className="text-muted-foreground mt-1 text-sm">
              <Trans>
                The key that authorizes this organization's AI. It covers Aubrey, workflow
                generation, DMS chat and AI stamps. Ask your WorkHub administrator for a key with
                the "ai.invoke" permission.
              </Trans>
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <StatusDot state={state} />
            <span className="text-[12px] font-medium">{label}</span>
          </div>
        </div>

        {test.data?.ok === false && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3">
            <AlertTriangleIcon className="text-destructive mt-0.5 h-4 w-4 shrink-0" />
            <div className="text-[12px]">
              <p className="font-medium">
                <Trans>The AI service rejected this key.</Trans>
              </p>
              {/* WorkHub's own words — the reader is an admin who asked, and this
                  is the difference between "call the platform team" and "check
                  my typing". */}
              {test.data.detail && (
                <p className="text-muted-foreground mt-0.5 font-mono">{test.data.detail}</p>
              )}
              {test.data.code === 'forbidden' && (
                <p className="mt-1.5">
                  <Trans>
                    Ask your WorkHub administrator to re-issue this key with the "ai.invoke"
                    permission.
                  </Trans>
                </p>
              )}
            </div>
          </div>
        )}

        {test.data?.ok === true && (
          <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
            <CheckCircle2Icon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p className="text-[12px]">
              <Trans>AI answered. Every AI feature is available to this organization.</Trans>
            </p>
          </div>
        )}

        {!endpointReady && (
          <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <AlertTriangleIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p className="text-[12px]">
              <Trans>
                This server has no AI service address configured, so a key alone won't be enough.
                Whoever runs the server needs to set it.
              </Trans>
            </p>
          </div>
        )}

        {showInput ? (
          <>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder="whk_..."
                className="font-mono"
                autoComplete="off"
                spellCheck={false}
                disabled={save.isPending}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && key.trim()) {
                    event.preventDefault();
                    save.mutate({ key: key.trim() });
                  }
                }}
              />
              <Button
                onClick={() => save.mutate({ key: key.trim() })}
                loading={save.isPending}
                disabled={!key.trim()}
              >
                <PlugZapIcon className="mr-1.5 h-4 w-4" />
                <Trans>Connect</Trans>
              </Button>
              {replacing && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setReplacing(false);
                    setKey('');
                  }}
                  disabled={save.isPending}
                >
                  <Trans>Cancel</Trans>
                </Button>
              )}
            </div>
            <p className="text-muted-foreground text-[11px]">
              <Trans>
                The key is stored for this organization and is never shown again after saving.
              </Trans>
            </p>
          </>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[12px]">
              whk_••••••••{hint}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                loading={test.isPending}
                onClick={() => test.mutate()}
              >
                <Trans>Test connection</Trans>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setReplacing(true)}>
                <Trans>Replace key</Trans>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={save.isPending}
                onClick={() => save.mutate({ key: null })}
              >
                <Trans>Disconnect</Trans>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

type DotState = 'none' | 'saved' | 'working' | 'failing';

const StatusDot = ({ state }: { state: DotState }) => {
  if (state === 'working') return <CheckCircle2Icon className="h-4 w-4 text-emerald-600" />;
  if (state === 'failing') return <AlertTriangleIcon className="text-destructive h-4 w-4" />;

  // "saved" is amber, not green: a key exists but nothing has proved it works.
  return (
    <span
      className={`inline-block h-2.5 w-2.5 rounded-full ${
        state === 'saved' ? 'bg-amber-500' : 'bg-muted-foreground/40'
      }`}
    />
  );
};
