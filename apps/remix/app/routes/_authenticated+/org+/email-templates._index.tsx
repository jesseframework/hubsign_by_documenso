import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { CopyIcon, MailIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { Link } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { OrgAdminGuard } from '~/components/general/org-admin-guard';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Email Templates');
}

function EmailTemplatesPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: templates, isLoading } = trpc.emailTemplate.list.useQuery();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const remove = trpc.emailTemplate.delete.useMutation({
    onSuccess: async () => {
      await utils.emailTemplate.list.invalidate();
      setConfirmingId(null);
      toast({ title: _(msg`Email template deleted`) });
    },
    onError: (error) => toast({ title: error.message, variant: 'destructive' }),
  });

  const copyKey = async (key: string) => {
    await navigator.clipboard.writeText(key);
    toast({ title: _(msg`Copied "${key}" — paste it into a workflow step`) });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">
            <Trans>Email Templates</Trans>
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <Trans>
              Reusable HTML bodies for workflow emails. Reference one from a SEND_EMAIL step by its
              key instead of pasting markup into the workflow JSON.
            </Trans>
          </p>
        </div>

        <Button size="sm" asChild>
          <Link to="/org/email-templates/new">
            <PlusIcon className="mr-1.5 h-4 w-4" />
            <Trans>New template</Trans>
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-[13px] text-muted-foreground">
          <Trans>Loading...</Trans>
        </div>
      ) : !templates || templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[var(--r)] border border-border bg-card py-16 text-center">
          <MailIcon className="mb-3 h-9 w-9 text-muted-foreground opacity-40" />
          <p className="text-[14px] font-medium">
            <Trans>No email templates yet</Trans>
          </p>
          <p className="mt-1 max-w-md text-[12px] text-muted-foreground">
            <Trans>
              Create one to move email markup out of your workflow JSON. Editing it here updates
              every workflow that references it.
            </Trans>
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-[var(--r)] border border-border bg-card">
          <table className="w-full">
            <thead className="border-b border-border bg-muted/30">
              <tr>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Name</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Key</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Subject</Trans>
                </th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {templates.map((template) => (
                <tr key={template.id} className="hover:bg-muted/20">
                  <td className="px-4 py-3">
                    <Link
                      to={`/org/email-templates/${template.id}`}
                      className="text-[13px] font-medium hover:underline"
                    >
                      {template.name}
                    </Link>
                    {template.description && (
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {template.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => void copyKey(template.key)}
                      className="group inline-flex items-center gap-1.5 rounded bg-muted px-2 py-1 font-mono text-[11px] hover:bg-muted/70"
                      title={_(msg`Copy key`)}
                    >
                      {template.key}
                      <CopyIcon className="h-3 w-3 opacity-40 group-hover:opacity-80" />
                    </button>
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-[12px] text-muted-foreground">
                    {template.subject}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {confirmingId === template.id ? (
                      <span className="inline-flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">
                          <Trans>Delete?</Trans>
                        </span>
                        <Button
                          size="sm"
                          variant="destructive"
                          className="h-7 text-[11px]"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ id: template.id })}
                        >
                          <Trans>Yes</Trans>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px]"
                          onClick={() => setConfirmingId(null)}
                        >
                          <Trans>Cancel</Trans>
                        </Button>
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-destructive"
                        onClick={() => setConfirmingId(template.id)}
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="rounded-[var(--r)] border border-border bg-muted/20 p-4">
        <p className="text-[12px] font-medium">
          <Trans>Using a template in a workflow</Trans>
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          <Trans>
            In a SEND_EMAIL step, replace the inline `html` and `subject` with `templateKey`. Set
            `subject` alongside it only if you want to override the template's own.
          </Trans>
        </p>
        <pre className="mt-2 overflow-x-auto rounded bg-card p-3 text-[11px] leading-relaxed">
          {`{
  "type": "ACTION",
  "config": {
    "action": "SEND_EMAIL",
    "to": "{{vars.vendor.email}}",
    "templateKey": "invoice-received"
  }
}`}
        </pre>
      </div>
    </div>
  );
}

/**
 * Administrative screen: withheld from ordinary members. The sidebar also
 * hides the link, but that alone would leave the URL directly reachable.
 */
export default function EmailTemplatesRoute() {
  return (
    <OrgAdminGuard>
      <EmailTemplatesPage />
    </OrgAdminGuard>
  );
}
