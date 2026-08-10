import { useState } from 'react';

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  DownloadIcon,
  FileSpreadsheetIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react';

import type { TExportConfig } from '@documenso/lib/types/export';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import { useToast } from '@documenso/ui/primitives/use-toast';

import { ExportBuilderDialog } from '~/components/general/export/export-builder-dialog';
import { appMetaTags } from '~/utils/meta';

export function meta() {
  return appMetaTags('Exports');
}

/**
 * Saved spreadsheet layouts, across every grid that can be exported.
 *
 * The builder is reachable from each grid's own Export button, which is where
 * someone usually wants it. This page is for the layouts themselves: the
 * month-end column set that took ten minutes to arrange and should not have to
 * be arranged again.
 */
export default function ExportsPage() {
  const { _ } = useLingui();
  const { toast } = useToast();
  const utils = trpc.useUtils();

  const { data: datasets } = trpc.export.datasets.useQuery();
  const { data: templates, isLoading } = trpc.export.templates.useQuery({});
  const deleteTemplate = trpc.export.deleteTemplate.useMutation();

  const [builder, setBuilder] = useState<{
    datasetId: string;
    config?: TExportConfig;
    name?: string;
  } | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);

  const datasetLabel = (id: string) => datasets?.find((d) => d.id === id)?.label ?? id;

  /** Run a saved layout without opening the builder. */
  const runTemplate = async (id: string, name: string, config: TExportConfig) => {
    setDownloading(id);

    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const problem = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(problem.error ?? 'Export failed');
      }

      const rows = Number(response.headers.get('X-Export-Rows') ?? '0');
      const truncated = response.headers.get('X-Export-Truncated') === '1';

      const blob = await response.blob();
      const filename =
        response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        `${name}.xlsx`;

      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      toast({
        title: _(msg`Export downloaded`),
        description: truncated
          ? _(msg`${rows} rows — capped. See the "Export notes" sheet in the file.`)
          : _(msg`${rows} rows.`),
      });
    } catch (error) {
      toast({
        title: _(msg`Export failed`),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setDownloading(null);
    }
  };

  const remove = async (id: string, name: string) => {
    try {
      await deleteTemplate.mutateAsync({ id });
      await utils.export.templates.invalidate();
      toast({ title: _(msg`Layout deleted`), description: name });
    } catch (error) {
      toast({
        title: _(msg`Could not delete the layout`),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold">
            <Trans>Exports</Trans>
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            <Trans>
              Saved spreadsheet layouts. Build one here, or from the Export button on any grid.
            </Trans>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {(datasets ?? []).map((dataset) => (
            <Button
              key={dataset.id}
              size="sm"
              variant="outline"
              className="h-8 text-[12px]"
              onClick={() => setBuilder({ datasetId: dataset.id })}
            >
              <PlusIcon className="mr-1 h-3.5 w-3.5" />
              <Trans>New {dataset.label} export</Trans>
            </Button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-muted-foreground">
          <Trans>Loading…</Trans>
        </div>
      ) : !templates || templates.length === 0 ? (
        <div className="rounded-[var(--r)] border border-dashed border-border bg-card py-14 text-center">
          <FileSpreadsheetIcon className="mx-auto mb-3 h-10 w-10 opacity-30" />
          <p className="text-[14px] font-medium">
            <Trans>No saved layouts yet</Trans>
          </p>
          <p className="mx-auto mt-1 max-w-md text-[12px] text-muted-foreground">
            <Trans>
              Arrange the columns you want once, save the layout, and it will be here next month.
            </Trans>
          </p>
        </div>
      ) : (
        <div className="rounded-[var(--r)] border border-border bg-card">
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-[#faf9fe] dark:bg-muted/30">
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Layout</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Grid</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Columns</Trans>
                </th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Created by</Trans>
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
                  <Trans>Actions</Trans>
                </th>
              </tr>
            </thead>
            <tbody>
              {templates.map((template) => {
                const config = template.config as TExportConfig;

                return (
                  <tr key={template.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3 align-top">
                      <p className="text-[13px] font-medium">{template.name}</p>
                      {template.description && (
                        <p className="text-[11px] text-muted-foreground">{template.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-[12px]">
                      {datasetLabel(template.datasetId)}
                    </td>
                    <td className="px-4 py-3 align-top text-[12px] text-muted-foreground">
                      <Trans>{config.columns?.length ?? 0} columns</Trans>
                      {config.joins?.length > 0 && (
                        <span className="ml-1">
                          <Trans>+{config.joins.length} joined</Trans>
                        </span>
                      )}
                      {config.filters?.length > 0 && (
                        <span className="ml-1">
                          <Trans>· {config.filters.length} filter(s)</Trans>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top text-[12px] text-muted-foreground">
                      {template.createdBy?.name || template.createdBy?.email || '—'}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          className="h-7 text-[11px]"
                          disabled={downloading === template.id}
                          onClick={() => void runTemplate(template.id, template.name, config)}
                        >
                          <DownloadIcon className="mr-1 h-3.5 w-3.5" />
                          <Trans>Download</Trans>
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px]"
                          title={_(msg`Edit layout`)}
                          onClick={() =>
                            setBuilder({
                              datasetId: template.datasetId,
                              config,
                              name: template.name,
                            })
                          }
                        >
                          <PencilIcon className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 text-[11px] text-muted-foreground hover:text-red-600"
                          title={_(msg`Delete layout`)}
                          onClick={() => void remove(template.id, template.name)}
                        >
                          <Trash2Icon className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {builder && (
        <ExportBuilderDialog
          datasetId={builder.datasetId}
          open
          onOpenChange={(open) => !open && setBuilder(null)}
          initialConfig={builder.config}
          initialName={builder.name}
        />
      )}
    </div>
  );
}
