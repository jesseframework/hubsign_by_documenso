import { useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { CheckCircle2Icon, PlugIcon, SendIcon, Trash2Icon, XCircleIcon } from 'lucide-react';

import { WORKFLOW_EVENTS, type WorkflowEventKey } from '@documenso/lib/types/workflow';
import { trpc } from '@documenso/trpc/react';
import { Badge } from '@documenso/ui/primitives/badge';
import { Button } from '@documenso/ui/primitives/button';
import { Checkbox } from '@documenso/ui/primitives/checkbox';
import { Input } from '@documenso/ui/primitives/input';
import { Switch } from '@documenso/ui/primitives/switch';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';
import { OrgAdminGuard } from '~/components/general/org-admin-guard';

export function meta() {
  return appMetaTags('Integrations');
}

const label = 'mb-1 block text-[11px] font-medium text-muted-foreground';

/** Group the workflow events the way the workflow builder does. */
const EVENT_GROUPS = Array.from(new Set(WORKFLOW_EVENTS.map((e) => e.group)));

function IntegrationsPage() {
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.msTeams.getConnection.useQuery();

  const [name, setName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [events, setEvents] = useState<WorkflowEventKey[]>([]);
  const [digest, setDigest] = useState(false);
  const [digestCron, setDigestCron] = useState('0 9 * * 1-5');

  const onError = (err: { message: string }) =>
    toast({ title: 'Something went wrong', description: err.message, variant: 'destructive' });

  const invalidate = () => void utils.msTeams.getConnection.invalidate();

  const connect = trpc.msTeams.connect.useMutation({ onSuccess: invalidate, onError });
  const setEnabled = trpc.msTeams.setEnabled.useMutation({ onSuccess: invalidate, onError });
  const disconnect = trpc.msTeams.disconnect.useMutation({ onSuccess: invalidate, onError });
  const deleteChannel = trpc.msTeams.deleteChannel.useMutation({ onSuccess: invalidate, onError });

  const addChannel = trpc.msTeams.addWebhookChannel.useMutation({
    onSuccess: () => {
      setName('');
      setWebhookUrl('');
      setEvents([]);
      setDigest(false);
      invalidate();
      toast({ title: 'Channel added' });
    },
    onError,
  });

  const testChannel = trpc.msTeams.testChannel.useMutation({
    onSuccess: (result) => {
      // The mutation resolves even when Teams rejected the post — say so plainly
      // rather than showing a green tick for a failed delivery.
      if (result.ok) {
        toast({ title: 'Test card sent', description: 'Check the Teams channel.' });
      } else {
        toast({
          title: 'Teams rejected the test card',
          description: result.error ?? `HTTP ${result.status ?? '???'}`,
          variant: 'destructive',
        });
      }
      invalidate();
    },
    onError,
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  const connection = data?.connection;
  const canManage = data?.canManage ?? false;
  const botConfigured = data?.botConfigured ?? false;

  const toggleEvent = (key: WorkflowEventKey) =>
    setEvents((prev) => (prev.includes(key) ? prev.filter((e) => e !== key) : [...prev, key]));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">
          <Trans>Integrations</Trans>
        </h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          <Trans>
            Connect Microsoft Teams to post document notifications into a channel. The connection
            belongs to your organization — every member's documents flow through it.
          </Trans>
        </p>
      </div>

      {!canManage && (
        <div className="rounded-md border border-border bg-muted/40 p-3 text-[13px] text-muted-foreground">
          <Trans>Only organization admins and managers can change these settings.</Trans>
        </div>
      )}

      {/* ── Connection ─────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <PlugIcon className="h-4 w-4" />
              <Trans>Microsoft Teams</Trans>
              {connection && (
                <Badge variant={connection.enabled ? 'default' : 'secondary'}>
                  {connection.transport}
                </Badge>
              )}
            </h3>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {connection ? (
                <Trans>One connection per organization. Add channels below.</Trans>
              ) : (
                <Trans>Not connected yet.</Trans>
              )}
            </p>
          </div>

          {connection && canManage && (
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-[13px]">
                <Switch
                  checked={connection.enabled}
                  onCheckedChange={(enabled) => setEnabled.mutate({ enabled })}
                  disabled={setEnabled.isPending}
                />
                <Trans>Enabled</Trans>
              </label>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => disconnect.mutate()}
                loading={disconnect.isPending}
              >
                <Trans>Disconnect</Trans>
              </Button>
            </div>
          )}
        </div>

        {!connection && canManage && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => connect.mutate({ transport: 'WEBHOOK' })}
              loading={connect.isPending}
            >
              <Trans>Connect via webhook</Trans>
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={!botConfigured}
              onClick={() => connect.mutate({ transport: 'BOT' })}
              loading={connect.isPending}
            >
              <Trans>Connect via bot</Trans>
            </Button>
          </div>
        )}

        {!botConfigured && (
          <p className="mt-3 text-[12px] text-muted-foreground">
            <Trans>
              The bot transport is unavailable — this deployment has no Azure Bot credentials. The
              webhook transport posts the same cards, but cannot update a card after it is posted,
              so live trackers and in-Teams buttons are disabled.
            </Trans>
          </p>
        )}
      </section>

      {/* ── Channels ───────────────────────────────────────────────── */}
      {connection && (
        <section className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">
            <Trans>Channels</Trans>
          </h3>

          {connection.channels.length === 0 ? (
            <p className="mt-2 text-[13px] text-muted-foreground">
              <Trans>No channels yet.</Trans>
            </p>
          ) : (
            <table className="mt-3 w-full text-[13px]">
              <thead className="text-left text-[11px] uppercase text-muted-foreground">
                <tr className="border-b border-border">
                  <th className="pb-2 font-medium">
                    <Trans>Name</Trans>
                  </th>
                  <th className="pb-2 font-medium">
                    <Trans>Destination</Trans>
                  </th>
                  <th className="pb-2 font-medium">
                    <Trans>Events</Trans>
                  </th>
                  <th className="pb-2" />
                </tr>
              </thead>
              <tbody>
                {connection.channels.map((channel) => (
                  <tr key={channel.id} className="border-b border-border last:border-0">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        {channel.enabled ? (
                          <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <XCircleIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                        {channel.name}
                      </div>
                    </td>
                    <td className="py-2 font-mono text-[11px] text-muted-foreground">
                      {channel.webhookUrlHint ?? channel.conversationId ?? '—'}
                    </td>
                    <td className="py-2 text-muted-foreground">
                      {channel.events.length === 0 ? (
                        <Trans>All events</Trans>
                      ) : (
                        `${channel.events.length} selected`
                      )}
                      {channel.digest && ` · digest ${channel.digestCron}`}
                    </td>
                    <td className="py-2 text-right">
                      {canManage && (
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            title="Send a test card"
                            onClick={() => testChannel.mutate({ id: channel.id })}
                            loading={testChannel.isPending}
                          >
                            <SendIcon className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteChannel.mutate({ id: channel.id })}
                          >
                            <Trash2Icon className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}

      {/* ── Add a webhook channel ──────────────────────────────────── */}
      {connection?.transport === 'WEBHOOK' && canManage && (
        <section className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">
            <Trans>Add a channel</Trans>
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <Trans>
              In Teams, open the channel → ⋯ → Workflows → "Post to a channel when a webhook request
              is received". Once the flow is saved, use "Copy webhook link" and paste the URL here.
              Do not use the legacy "Incoming Webhook" connector — Microsoft is retiring it.
            </Trans>
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div>
              <span className={label}>
                <Trans>Name</Trans>
              </span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Acme Corp > #contracts"
              />
            </div>
            <div>
              <span className={label}>
                <Trans>Power Automate webhook URL</Trans>
              </span>
              <Input
                type="password"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://prod-12.westus.logic.azure.com/workflows/…"
              />
            </div>
          </div>

          <div className="mt-4">
            <span className={label}>
              <Trans>Events — leave all unchecked to receive every event</Trans>
            </span>
            <div className="space-y-2">
              {EVENT_GROUPS.map((group) => (
                <div key={group}>
                  <p className="text-[11px] font-medium text-muted-foreground">{group}</p>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                    {WORKFLOW_EVENTS.filter((e) => e.group === group).map((event) => (
                      <label key={event.key} className="flex items-center gap-1.5 text-[13px]">
                        <Checkbox
                          checked={events.includes(event.key)}
                          onCheckedChange={() => toggleEvent(event.key)}
                        />
                        {event.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-end gap-3">
            <label className="flex items-center gap-2 text-[13px]">
              <Switch checked={digest} onCheckedChange={setDigest} />
              <Trans>Post a recurring digest</Trans>
            </label>
            {digest && (
              <div>
                <span className={label}>
                  <Trans>Cron (5-field)</Trans>
                </span>
                <Input
                  value={digestCron}
                  onChange={(e) => setDigestCron(e.target.value)}
                  className="w-40 font-mono text-[12px]"
                />
              </div>
            )}
          </div>

          <Button
            className="mt-4"
            size="sm"
            disabled={!name.trim() || !webhookUrl.trim()}
            loading={addChannel.isPending}
            onClick={() =>
              addChannel.mutate({
                name,
                webhookUrl,
                events,
                digest,
                digestCron: digest ? digestCron : undefined,
                digestTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
              })
            }
          >
            <Trans>Add channel</Trans>
          </Button>
        </section>
      )}

      {connection?.transport === 'BOT' && (
        <section className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold">
            <Trans>Add a channel</Trans>
          </h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            <Trans>
              Install the HubSign app in Teams, then add it to a channel. The bot will post a link
              prompt there — follow it back here to bind that channel to this organization.
            </Trans>
          </p>
        </section>
      )}
    </div>
  );
}

/**
 * Administrative screen: withheld from ordinary members. The sidebar also
 * hides the link, but that alone would leave the URL directly reachable.
 */
export default function IntegrationsPageRoute() {
  return (
    <OrgAdminGuard>
      <IntegrationsPage />
    </OrgAdminGuard>
  );
}
