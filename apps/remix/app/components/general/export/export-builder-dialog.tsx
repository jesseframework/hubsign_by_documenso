import { useEffect, useMemo, useState } from 'react';

import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import {
  ArrowDownIcon,
  ArrowUpIcon,
  DownloadIcon,
  GripVerticalIcon,
  Link2Icon,
  Link2OffIcon,
  Loader2Icon,
  PlusIcon,
  SaveIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  XIcon,
} from 'lucide-react';

import {
  EXPORT_COLUMN_LIMIT,
  type TExportColumn,
  type TExportConfig,
  type TExportFilterValue,
  type TExportJoin,
  findDuplicateColumns,
} from '@documenso/lib/types/export';
import { trpc } from '@documenso/trpc/react';
import { Button } from '@documenso/ui/primitives/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@documenso/ui/primitives/dialog';
import { Input } from '@documenso/ui/primitives/input';
import { useToast } from '@documenso/ui/primitives/use-toast';

/**
 * "Choose your columns, then download a spreadsheet."
 *
 * Deliberately generic: it renders whatever the dataset's catalogue describes,
 * so registering a second grid needs no changes here. The left panel is the
 * catalogue grouped by section; the right panel is the sheet as it will be
 * written — order top to bottom is left to right in Excel.
 */

type CatalogueColumn = {
  key: string;
  label: string;
  group: string;
  type: string;
  hint?: string;
  isDefault?: boolean;
};

type Props = {
  datasetId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Seeded from the grid's own filters so the export starts where the user is. */
  initialFilters?: { id: string; value: TExportFilterValue }[];
  /** Loaded when the user opens a saved layout from the Exports page. */
  initialConfig?: TExportConfig;
  initialName?: string;
};

let customColumnCounter = 0;

export function ExportBuilderDialog({
  datasetId,
  open,
  onOpenChange,
  initialFilters,
  initialConfig,
  initialName,
}: Props) {
  const { _ } = useLingui();
  const { toast } = useToast();

  const { data: catalogue, isLoading } = trpc.export.catalogue.useQuery(
    { datasetId },
    { enabled: open },
  );

  const [selected, setSelected] = useState<TExportColumn[]>([]);
  const [joins, setJoins] = useState<TExportJoin[]>([]);
  const [joinColumns, setJoinColumns] = useState<Record<string, CatalogueColumn[]>>({});
  const [filters, setFilters] = useState<Record<string, TExportFilterValue>>({});
  const [search, setSearch] = useState('');
  const [sheetName, setSheetName] = useState('');
  const [templateName, setTemplateName] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [seeded, setSeeded] = useState(false);

  const saveTemplate = trpc.export.saveTemplate.useMutation();
  const utils = trpc.useUtils();

  // Seed once per opening: the default columns for a fresh export, or the saved
  // layout when one was opened.
  useEffect(() => {
    if (!open) {
      setSeeded(false);
      return;
    }
    if (seeded || !catalogue) return;

    if (initialConfig) {
      setSelected(initialConfig.columns);
      setJoins(initialConfig.joins);
      setFilters(Object.fromEntries(initialConfig.filters.map((f) => [f.id, f.value])));
      setSheetName(initialConfig.sheetName ?? '');
      setTemplateName(initialName ?? '');
    } else {
      setSelected(
        catalogue.columns
          .filter((column) => column.isDefault)
          .map((column) => ({ key: column.key, label: column.label })),
      );
      setJoins([]);
      setFilters(Object.fromEntries((initialFilters ?? []).map((f) => [f.id, f.value])));
      setSheetName(catalogue.label);
      setTemplateName('');
    }

    setSeeded(true);
  }, [open, seeded, catalogue, initialConfig, initialName, initialFilters]);

  const availableColumns = useMemo(() => {
    const own = catalogue?.columns ?? [];
    const joined = joins.flatMap((join) =>
      (joinColumns[join.alias] ?? []).map((column) => ({
        ...column,
        key: `join:${join.alias}.${column.key}`,
        group: `${column.group} (${join.alias})`,
      })),
    );

    return [...own, ...joined];
  }, [catalogue, joins, joinColumns]);

  const selectedKeys = useMemo(() => new Set(selected.map((c) => c.key)), [selected]);

  const grouped = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const matching = availableColumns.filter(
      (column) =>
        needle === '' ||
        column.label.toLowerCase().includes(needle) ||
        column.key.toLowerCase().includes(needle),
    );

    const map = new Map<string, CatalogueColumn[]>();
    for (const column of matching) {
      const list = map.get(column.group) ?? [];
      list.push(column);
      map.set(column.group, list);
    }

    const order = catalogue?.groupOrder ?? [];
    return [...map.entries()].sort(([a], [b]) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
  }, [availableColumns, search, catalogue]);

  const duplicates = useMemo(() => findDuplicateColumns(selected), [selected]);

  const toggleColumn = (column: CatalogueColumn) => {
    setSelected((current) =>
      current.some((c) => c.key === column.key)
        ? current.filter((c) => c.key !== column.key)
        : current.length >= EXPORT_COLUMN_LIMIT
          ? current
          : [...current, { key: column.key, label: column.label }],
    );
  };

  const move = (index: number, delta: number) => {
    setSelected((current) => {
      const target = index + delta;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const sensors = useSensors(
    // A small distance threshold means a click on the rename input or the
    // delete button is still a click, not the start of a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setSelected((current) => {
      const from = current.findIndex((c) => c.key === active.id);
      const to = current.findIndex((c) => c.key === over.id);
      if (from === -1 || to === -1) return current;

      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const buildConfig = (): TExportConfig => ({
    datasetId,
    columns: selected,
    joins,
    filters: Object.entries(filters)
      .filter(([, value]) => isFilterSet(value))
      .map(([id, value]) => ({ id, value })),
    sheetName: sheetName.trim() || undefined,
  });

  const validate = () => {
    if (selected.length === 0) {
      toast({ title: _(msg`Pick at least one column to export.`), variant: 'destructive' });
      return false;
    }
    if (duplicates.duplicateLabels.length > 0) {
      toast({
        title: _(msg`Two columns share a heading`),
        description: duplicates.duplicateLabels[0],
        variant: 'destructive',
      });
      return false;
    }
    return true;
  };

  const download = async () => {
    if (!validate()) return;

    setIsDownloading(true);

    try {
      const response = await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(buildConfig()),
      });

      if (!response.ok) {
        const problem = await response.json().catch(() => ({ error: response.statusText }));
        throw new Error(problem.error ?? 'Export failed');
      }

      const rows = Number(response.headers.get('X-Export-Rows') ?? '0');
      const total = Number(response.headers.get('X-Export-Total') ?? '0');
      const truncated = response.headers.get('X-Export-Truncated') === '1';

      const blob = await response.blob();
      const filename =
        response.headers.get('Content-Disposition')?.match(/filename="([^"]+)"/)?.[1] ??
        'export.xlsx';

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
          ? _(msg`${rows} of ${total} rows — the export is capped. See the "Export notes" sheet.`)
          : _(msg`${rows} rows, ${selected.length} columns.`),
      });

      onOpenChange(false);
    } catch (error) {
      toast({
        title: _(msg`Export failed`),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const save = async () => {
    if (!validate()) return;

    if (templateName.trim() === '') {
      toast({ title: _(msg`Give the layout a name before saving it.`), variant: 'destructive' });
      return;
    }

    try {
      await saveTemplate.mutateAsync({ name: templateName.trim(), config: buildConfig() });
      await utils.export.templates.invalidate();
      toast({ title: _(msg`Layout saved`), description: templateName.trim() });
    } catch (error) {
      toast({
        title: _(msg`Could not save the layout`),
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        position="center"
        className="max-h-[92vh] w-[96vw] max-w-6xl overflow-hidden sm:max-w-6xl"
      >
        <DialogHeader>
          <DialogTitle>
            <Trans>Configure export — select, reorder & download</Trans>
          </DialogTitle>
          <DialogDescription>
            {catalogue ? (
              catalogue.description
            ) : (
              <Trans>Choose the columns to write into the spreadsheet.</Trans>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading || !catalogue ? (
          <div className="flex items-center justify-center py-16 text-muted-foreground">
            <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
            <Trans>Loading the available columns…</Trans>
          </div>
        ) : (
          <>
            {/* Filters — what goes in the file, before choosing what to show */}
            <div className="rounded-[var(--r-sm)] border border-border">
              <button
                type="button"
                onClick={() => setShowFilters((o) => !o)}
                className="flex w-full items-center gap-2 px-3 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground"
              >
                <SlidersHorizontalIcon className="h-3.5 w-3.5" />
                <Trans>Export filters</Trans>
                {activeFilterCount(filters) > 0 && (
                  <span className="rounded-full bg-primary/10 px-1.5 text-[10px] font-semibold text-primary">
                    {activeFilterCount(filters)}
                  </span>
                )}
                <span className="ml-auto text-[11px] font-normal">
                  {showFilters ? <Trans>hide</Trans> : <Trans>show</Trans>}
                </span>
              </button>

              {showFilters && (
                <div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {catalogue.filters.map((filter) => (
                    <FilterControl
                      key={filter.id}
                      filter={filter}
                      value={filters[filter.id]}
                      onChange={(value) => setFilters((f) => ({ ...f, [filter.id]: value }))}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-3 overflow-hidden lg:grid-cols-[1fr_1.15fr]">
              {/* ---- Available ------------------------------------------- */}
              <div className="flex min-h-0 flex-col rounded-[var(--r-sm)] border border-border">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <p className="text-[12px] font-semibold">
                    <Trans>Available columns</Trans>
                  </p>
                  <div className="flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px]"
                      onClick={() =>
                        setSelected(
                          availableColumns
                            .slice(0, EXPORT_COLUMN_LIMIT)
                            .map((c) => ({ key: c.key, label: c.label })),
                        )
                      }
                    >
                      <Trans>All</Trans>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setSelected([])}
                    >
                      <Trans>Clear</Trans>
                    </Button>
                  </div>
                </div>

                <div className="border-b border-border p-2">
                  <div className="relative">
                    <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={_(msg`Search columns…`)}
                      className="h-8 pl-8 text-[12px]"
                    />
                  </div>
                </div>

                <div className="custom-scrollbar max-h-[46vh] min-h-[16rem] overflow-y-auto p-2">
                  {grouped.length === 0 ? (
                    <p className="py-6 text-center text-[12px] text-muted-foreground">
                      <Trans>No columns match “{search}”.</Trans>
                    </p>
                  ) : (
                    grouped.map(([group, columns]) => (
                      <div key={group} className="mb-3">
                        <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                          {group}
                        </p>
                        {columns.map((column) => (
                          <label
                            key={column.key}
                            className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-muted/50"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 accent-[var(--primary)]"
                              checked={selectedKeys.has(column.key)}
                              onChange={() => toggleColumn(column)}
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-[12px]">{column.label}</span>
                              {column.hint && (
                                <span className="block text-[10px] leading-tight text-muted-foreground">
                                  {column.hint}
                                </span>
                              )}
                            </span>
                          </label>
                        ))}
                      </div>
                    ))
                  )}
                </div>

                {/* ---- Reference tables (the passthrough join) ------------ */}
                <div className="border-t border-border p-2">
                  <p className="mb-1.5 px-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    <Trans>Reference tables</Trans>
                  </p>
                  {catalogue.joins.map((join) => {
                    const attached = joins.find((j) => j.id === join.id);

                    return (
                      <div key={join.id} className="rounded-[var(--r-sm)] bg-muted/30 p-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[12px] font-medium">{join.label}</p>
                            <p className="text-[10px] leading-tight text-muted-foreground">
                              {join.matchDescription}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant={attached ? 'outline' : 'default'}
                            className="h-6 flex-shrink-0 px-2 text-[11px]"
                            onClick={() => {
                              if (attached) {
                                setJoins((current) => current.filter((j) => j.id !== join.id));
                                setSelected((current) =>
                                  current.filter((c) => !c.key.startsWith(`join:${attached.alias}.`)),
                                );
                              } else {
                                setJoins((current) => [
                                  ...current,
                                  { id: join.id, alias: defaultAlias(join.id), options: {} },
                                ]);
                              }
                            }}
                          >
                            {attached ? (
                              <>
                                <Link2OffIcon className="mr-1 h-3 w-3" />
                                <Trans>Detach</Trans>
                              </>
                            ) : (
                              <>
                                <Link2Icon className="mr-1 h-3 w-3" />
                                <Trans>Attach</Trans>
                              </>
                            )}
                          </Button>
                        </div>

                        {attached && (
                          <JoinOptions
                            datasetId={datasetId}
                            join={join}
                            attached={attached}
                            onOptionsChange={(options) =>
                              setJoins((current) =>
                                current.map((j) => (j.id === join.id ? { ...j, options } : j)),
                              )
                            }
                            onColumns={(columns) =>
                              setJoinColumns((current) => ({ ...current, [attached.alias]: columns }))
                            }
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ---- Selected -------------------------------------------- */}
              <div className="flex min-h-0 flex-col rounded-[var(--r-sm)] border border-border">
                <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                  <p className="text-[12px] font-semibold">
                    <Trans>Selected columns</Trans>{' '}
                    <span className="rounded-full bg-primary px-1.5 text-[10px] text-primary-foreground">
                      {selected.length}
                    </span>
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => {
                      customColumnCounter += 1;
                      setSelected((current) => [
                        ...current,
                        {
                          key: `const:c${customColumnCounter}${Date.now().toString(36)}`,
                          label: `Column ${current.length + 1}`,
                          value: '',
                        },
                      ]);
                    }}
                  >
                    <PlusIcon className="mr-1 h-3 w-3" />
                    <Trans>Add custom</Trans>
                  </Button>
                </div>

                <p className="border-b border-border bg-muted/20 px-3 py-1.5 text-[10px] text-muted-foreground">
                  <Trans>
                    Drag to reorder — top to bottom is left to right in Excel. Click a heading to
                    rename it.
                  </Trans>
                </p>

                <div className="custom-scrollbar max-h-[52vh] min-h-[16rem] overflow-y-auto p-2">
                  {selected.length === 0 ? (
                    <p className="py-10 text-center text-[12px] text-muted-foreground">
                      <Trans>Nothing selected yet. Tick columns on the left.</Trans>
                    </p>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={onDragEnd}
                    >
                      <SortableContext
                        items={selected.map((c) => c.key)}
                        strategy={verticalListSortingStrategy}
                      >
                        {selected.map((column, index) => (
                          <SelectedRow
                            key={column.key}
                            column={column}
                            index={index}
                            total={selected.length}
                            isDuplicateLabel={duplicates.duplicateLabels.some(
                              (l) => l.toLowerCase() === column.label.trim().toLowerCase(),
                            )}
                            onRename={(label) =>
                              setSelected((current) =>
                                current.map((c, i) => (i === index ? { ...c, label } : c)),
                              )
                            }
                            onValueChange={(value) =>
                              setSelected((current) =>
                                current.map((c, i) => (i === index ? { ...c, value } : c)),
                              )
                            }
                            onRemove={() =>
                              setSelected((current) => current.filter((_, i) => i !== index))
                            }
                            onMove={(delta) => move(index, delta)}
                          />
                        ))}
                      </SortableContext>
                    </DndContext>
                  )}
                </div>
              </div>
            </div>

            {/* ---- Footer ----------------------------------------------- */}
            <div className="flex flex-wrap items-end justify-between gap-3 border-t border-border pt-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    <Trans>Sheet name</Trans>
                  </span>
                  <Input
                    value={sheetName}
                    onChange={(e) => setSheetName(e.target.value)}
                    maxLength={31}
                    className="h-8 w-44 text-[12px]"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
                    <Trans>Save this layout as</Trans>
                  </span>
                  <Input
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    placeholder={_(msg`e.g. Monthly AP review`)}
                    className="h-8 w-52 text-[12px]"
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  className="h-8 text-[12px]"
                  disabled={saveTemplate.isPending}
                  onClick={() => void save()}
                >
                  <SaveIcon className="mr-1 h-3.5 w-3.5" />
                  <Trans>Save layout</Trans>
                </Button>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="h-9"
                  onClick={() => onOpenChange(false)}
                >
                  <Trans>Cancel</Trans>
                </Button>
                <Button type="button" className="h-9" disabled={isDownloading} onClick={() => void download()}>
                  {isDownloading ? (
                    <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <DownloadIcon className="mr-1.5 h-4 w-4" />
                  )}
                  <Trans>Save & Download Excel</Trans>
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** One row of the selected list: grip, index, heading, delete. */
function SelectedRow({
  column,
  index,
  total,
  isDuplicateLabel,
  onRename,
  onValueChange,
  onRemove,
  onMove,
}: {
  column: TExportColumn;
  index: number;
  total: number;
  isDuplicateLabel: boolean;
  onRename: (label: string) => void;
  onValueChange: (value: string) => void;
  onRemove: () => void;
  onMove: (delta: number) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: column.key,
  });

  const isCustom = column.key.startsWith('const:');

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`mb-1 flex items-center gap-1.5 rounded-[var(--r-sm)] border px-1.5 py-1 ${
        isDragging ? 'z-10 border-primary bg-card shadow-md' : 'border-border bg-background'
      } ${isCustom ? 'border-l-2 border-l-amber-500' : ''}`}
    >
      {/*
        Listeners live on the grip alone. Spread onto the row, the pointer
        sensor swallows the first mousedown on the rename input and the field
        cannot be focused by clicking it.
      */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label="Reorder"
        className="cursor-grab touch-none rounded p-0.5 text-muted-foreground hover:bg-muted active:cursor-grabbing"
      >
        <GripVerticalIcon className="h-3.5 w-3.5" />
      </button>

      <span className="w-5 flex-shrink-0 text-right text-[10px] tabular-nums text-muted-foreground">
        {index + 1}
      </span>

      <Input
        value={column.label}
        onChange={(e) => onRename(e.target.value)}
        className={`h-7 flex-1 text-[12px] ${isDuplicateLabel ? 'border-red-500' : ''}`}
      />

      {isCustom && (
        <Input
          value={column.value ?? ''}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder="fixed value"
          className="h-7 w-28 text-[12px]"
        />
      )}

      <div className="flex flex-shrink-0 items-center">
        <button
          type="button"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label="Move up"
          className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
        >
          <ArrowUpIcon className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label="Move down"
          className="rounded p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
        >
          <ArrowDownIcon className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove column"
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-red-600"
        >
          <XIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/**
 * Options for an attached reference table, plus the fetch of the columns it
 * contributes. A child component so each attached table gets its own query
 * without the parent calling hooks in a loop.
 */
function JoinOptions({
  datasetId,
  join,
  attached,
  onOptionsChange,
  onColumns,
}: {
  datasetId: string;
  join: { id: string; label: string; options: { id: string; label: string; hint?: string }[] };
  attached: TExportJoin;
  onOptionsChange: (options: Record<string, string>) => void;
  onColumns: (columns: CatalogueColumn[]) => void;
}) {
  const { data } = trpc.export.joinColumns.useQuery({
    datasetId,
    joinId: join.id,
    options: attached.options,
  });

  useEffect(() => {
    if (data?.columns) {
      onColumns(data.columns as CatalogueColumn[]);
    }
    // `onColumns` is recreated each render by the parent; depending on it would
    // loop. The column list is the only thing that should retrigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.columns]);

  return (
    <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
      <div className="grid grid-cols-2 gap-1.5">
        {join.options.map((option) => (
          <label key={option.id} className="block">
            <span className="mb-0.5 block text-[10px] text-muted-foreground">{option.label}</span>
            <Input
              value={attached.options[option.id] ?? ''}
              onChange={(e) =>
                onOptionsChange({ ...attached.options, [option.id]: e.target.value })
              }
              placeholder={option.hint}
              className="h-7 text-[11px]"
            />
          </label>
        ))}
      </div>
      {data?.notes.map((note, index) => (
        <p key={index} className="text-[10px] leading-tight text-muted-foreground">
          {note}
        </p>
      ))}
    </div>
  );
}

function FilterControl({
  filter,
  value,
  onChange,
}: {
  filter: { id: string; label: string; kind: string; hint?: string; options?: { value: string; label: string }[] };
  value: TExportFilterValue | undefined;
  onChange: (value: TExportFilterValue) => void;
}) {
  return (
    <div>
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {filter.label}
      </p>

      {filter.kind === 'text' && (
        <Input
          value={value?.kind === 'text' ? value.value : ''}
          onChange={(e) => onChange({ kind: 'text', value: e.target.value })}
          placeholder={filter.hint}
          className="h-8 text-[12px]"
        />
      )}

      {filter.kind === 'select' && (
        <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
          {(filter.options ?? []).map((option) => {
            const current = value?.kind === 'select' ? value.value : [];
            const active = current.includes(option.value);

            return (
              <button
                key={option.value}
                type="button"
                onClick={() =>
                  onChange({
                    kind: 'select',
                    value: active
                      ? current.filter((v) => v !== option.value)
                      : [...current, option.value],
                  })
                }
                className={`rounded-full border px-2 py-0.5 text-[11px] ${
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      )}

      {filter.kind === 'dateRange' && (
        <div className="flex items-center gap-1">
          <Input
            type="date"
            value={value?.kind === 'dateRange' ? (value.from?.slice(0, 10) ?? '') : ''}
            onChange={(e) =>
              onChange({
                kind: 'dateRange',
                from: e.target.value ? new Date(`${e.target.value}T00:00:00.000Z`).toISOString() : null,
                to: value?.kind === 'dateRange' ? value.to : null,
              })
            }
            className="h-8 text-[11px]"
          />
          <Input
            type="date"
            value={value?.kind === 'dateRange' ? (value.to?.slice(0, 10) ?? '') : ''}
            onChange={(e) =>
              onChange({
                kind: 'dateRange',
                from: value?.kind === 'dateRange' ? value.from : null,
                // Inclusive of the chosen day, otherwise picking today returns
                // nothing received today.
                to: e.target.value ? new Date(`${e.target.value}T23:59:59.999Z`).toISOString() : null,
              })
            }
            className="h-8 text-[11px]"
          />
        </div>
      )}

      {filter.kind === 'numberRange' && (
        <div className="flex items-center gap-1">
          <Input
            type="number"
            placeholder="min"
            value={value?.kind === 'numberRange' ? (value.min ?? '') : ''}
            onChange={(e) =>
              onChange({
                kind: 'numberRange',
                min: e.target.value === '' ? null : Number(e.target.value),
                max: value?.kind === 'numberRange' ? value.max : null,
              })
            }
            className="h-8 text-[11px]"
          />
          <Input
            type="number"
            placeholder="max"
            value={value?.kind === 'numberRange' ? (value.max ?? '') : ''}
            onChange={(e) =>
              onChange({
                kind: 'numberRange',
                min: value?.kind === 'numberRange' ? value.min : null,
                max: e.target.value === '' ? null : Number(e.target.value),
              })
            }
            className="h-8 text-[11px]"
          />
        </div>
      )}

      {filter.hint && filter.kind !== 'text' && (
        <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{filter.hint}</p>
      )}
    </div>
  );
}

const defaultAlias = (joinId: string) => joinId.replace(/[^a-zA-Z0-9_]/g, '') || 'ref';

const isFilterSet = (value: TExportFilterValue) => {
  switch (value.kind) {
    case 'text':
      return value.value.trim() !== '';
    case 'select':
      return value.value.length > 0;
    case 'dateRange':
      return value.from !== null || value.to !== null;
    case 'numberRange':
      return value.min !== null || value.max !== null;
    default:
      return false;
  }
};

const activeFilterCount = (filters: Record<string, TExportFilterValue>) =>
  Object.values(filters).filter(isFilterSet).length;
