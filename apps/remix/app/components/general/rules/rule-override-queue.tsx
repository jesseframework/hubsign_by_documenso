import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ShieldQuestionIcon } from 'lucide-react';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

/**
 * Signers waiting to be let past a blocking rule.
 *
 * Lives on the Business Rules page because that is where the person who wrote the
 * rule looks, and a request to waive one is a fact about that rule. Renders
 * nothing when the queue is empty, so it costs an admin nothing on the common day.
 *
 * Requests routed through an approval chain are shown but not decidable here —
 * deciding them in two places would leave the chain running with its approvers
 * still holding live links.
 */
export const RuleOverrideQueue = () => {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: pending } = trpc.businessRule.listOverrides.useQuery();
  const [notes, setNotes] = useState<Record<string, string>>({});

  const decide = trpc.businessRule.decideOverride.useMutation({
    onSuccess: async (_result, variables) => {
      await utils.businessRule.listOverrides.invalidate();
      toast({
        title: variables.approved
          ? _(msg`Exception approved — the signer can now sign`)
          : _(msg`Request declined`),
      });
    },
    onError: (e) => toast({ title: e.message, variant: 'destructive' }),
  });

  if (!pending || pending.length === 0) {
    return null;
  }

  return (
    <div className="rounded-[var(--r)] border border-status-pending-text/30 bg-card">
      <div className="flex items-start gap-3 border-b border-border p-4">
        <ShieldQuestionIcon className="mt-0.5 h-4 w-4 flex-shrink-0 text-status-pending-text" />
        <div>
          <h3 className="text-[13px] font-semibold">
            <Trans>Waiting on you — requests to sign despite a block</Trans>
          </h3>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            <Trans>
              A signer was stopped by a rule and cannot fix it themselves. Approving waives only
              the rules listed, and only for that document.
            </Trans>
          </p>
        </div>
      </div>

      <ul className="divide-y divide-border">
        {pending.map((item) => {
          const viaChain = Boolean(item.approvalRequestId);
          const isBusy = decide.isPending && decide.variables?.overrideId === item.id;

          return (
            <li key={item.id} className="p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[13px] font-medium">{item.document.title}</p>
                <p className="text-[11px] text-muted-foreground">
                  <Trans>
                    asked by {item.recipient?.name || item.recipient?.email || 'a signer'}
                  </Trans>
                  {' · '}
                  {new Date(item.createdAt).toLocaleString()}
                </p>
              </div>

              {/* What blocked them, verbatim as they saw it. */}
              <div className="mt-2 rounded-[var(--r-sm)] bg-muted/50 p-2.5">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Trans>What blocked them</Trans>
                </p>
                <div className="mt-1 space-y-0.5 text-[12px]">
                  {item.blockedReason
                    .split('\n')
                    .filter(Boolean)
                    .map((line, index) => (
                      <p key={index}>{line}</p>
                    ))}
                </div>
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  <Trans>Waives:</Trans> {item.rules.map((r) => r.ruleName).join(', ')}
                </p>
              </div>

              {item.reason && (
                <div className="mt-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <Trans>Their reason</Trans>
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[12px]">{item.reason}</p>
                </div>
              )}

              {viaChain ? (
                <p className="mt-3 text-[12px] text-muted-foreground">
                  <Trans>
                    This is with an approval chain. It will be granted automatically when the chain
                    approves.
                  </Trans>
                </p>
              ) : (
                <div className="mt-3">
                  <textarea
                    className="min-h-[52px] w-full resize-y rounded-[var(--r-sm)] border border-border bg-background p-2 text-[12px]"
                    placeholder="Note for the signer (optional — shown if you decline)"
                    value={notes[item.id] ?? ''}
                    onChange={(e) => setNotes({ ...notes, [item.id]: e.target.value })}
                    maxLength={1000}
                  />

                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-[11px]"
                      loading={isBusy && decide.variables?.approved === true}
                      disabled={isBusy}
                      onClick={() =>
                        decide.mutate({
                          overrideId: item.id,
                          approved: true,
                          note: notes[item.id]?.trim() || undefined,
                        })
                      }
                    >
                      <Trans>Approve exception</Trans>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11px]"
                      loading={isBusy && decide.variables?.approved === false}
                      disabled={isBusy}
                      onClick={() =>
                        decide.mutate({
                          overrideId: item.id,
                          approved: false,
                          note: notes[item.id]?.trim() || undefined,
                        })
                      }
                    >
                      <Trans>Decline</Trans>
                    </Button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
};
