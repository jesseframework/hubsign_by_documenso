import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import { ListChecksIcon, PlusIcon, SlidersHorizontalIcon, Trash2Icon } from 'lucide-react';
import { Link, useNavigate } from 'react-router';

import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Approval Templates');
}

export default function ApprovalTemplatesPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const navigate = useNavigate();
  const utils = trpc.useUtils();

  const { data: templates, isLoading } = trpc.approval.listTemplates.useQuery();

  const setActive = trpc.approval.setTemplateActive.useMutation({
    onSuccess: () => void utils.approval.listTemplates.invalidate(),
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });
  const remove = trpc.approval.deleteTemplate.useMutation({
    onSuccess: () => {
      void utils.approval.listTemplates.invalidate();
      toast({ title: _(msg`Template deleted`) });
    },
    onError: (e) => toast({ title: _(msg`Error`), description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">
            <Trans>Approval Setup</Trans>
          </h2>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <Trans>Design approval chains and the rules that pick them.</Trans>
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate('/org/approval-config')}>
            <SlidersHorizontalIcon className="mr-1 h-3.5 w-3.5" />
            <Trans>Rules &amp; validations</Trans>
          </Button>
          <Button size="sm" onClick={() => navigate('/org/approval-templates/new')}>
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            <Trans>New template</Trans>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">Loading…</div>
      ) : !templates || templates.length === 0 ? (
        <div className="rounded-[var(--r)] border border-dashed border-border bg-card py-14 text-center">
          <ListChecksIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-[14px] font-medium">
            <Trans>No approval templates yet</Trans>
          </p>
          <p className="mx-auto mt-1 max-w-sm text-[12px] text-muted-foreground">
            <Trans>
              Create a template with one or more approver steps. Mark one as default to gate inbound
              documents automatically.
            </Trans>
          </p>
          <Button size="sm" className="mt-4" onClick={() => navigate('/org/approval-templates/new')}>
            <PlusIcon className="mr-1 h-3.5 w-3.5" />
            <Trans>New template</Trans>
          </Button>
        </div>
      ) : (
        <div className="rounded-[var(--r)] border border-border bg-card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Name</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Entity</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Steps</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Default</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Status</Trans>
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Actions</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <Link
                      to={`/org/approval-templates/${t.id}`}
                      className="text-[13px] font-medium hover:text-primary hover:underline"
                    >
                      {t.name}
                    </Link>
                    {t.description && (
                      <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">
                        {t.description}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{t.entityType}</td>
                  <td className="px-4 py-3 text-[12px] text-muted-foreground">{t._count.steps}</td>
                  <td className="px-4 py-3">
                    {t.isDefault ? (
                      <span className="inline-flex rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                        default
                      </span>
                    ) : (
                      <span className="text-[12px] text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setActive.mutate({ id: t.id, isActive: !t.isActive })}
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
                        t.isActive
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
                          : 'bg-muted text-muted-foreground'
                      }`}
                    >
                      {t.isActive ? _(msg`Active`) : _(msg`Inactive`)}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-[11px] text-destructive"
                      onClick={() => {
                        if (window.confirm(_(msg`Delete "${t.name}"?`))) remove.mutate({ id: t.id });
                      }}
                    >
                      <Trash2Icon className="h-3 w-3" />
                      <Trans>Delete</Trans>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
