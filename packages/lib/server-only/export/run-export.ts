import type { TExportConfig } from '../../types/export';
import { EXPORT_ROW_LIMIT, parseColumnKey } from '../../types/export';
import { getDataset, getJoin } from './registry';
import type { ExportValue, ExportValueType, ParsedFilters, PreparedJoin } from './types';

/**
 * Turn a saved layout into rows of values.
 *
 * Kept separate from the spreadsheet writer so the same resolution can be
 * tested, previewed in the dialog, or written to some other format later
 * without exceljs being involved.
 */

export type ResolvedColumn = {
  key: string;
  label: string;
  type: ExportValueType;
};

export type ExportResult = {
  datasetLabel: string;
  columns: ResolvedColumn[];
  rows: ExportValue[][];
  /** Rows written. */
  rowCount: number;
  /** Rows that matched the filters, which may exceed `rowCount`. */
  totalMatching: number;
  truncated: boolean;
  /**
   * Everything a reader needs in order to know what this file does and does not
   * contain. Written into the workbook, never dropped.
   */
  notes: string[];
  /** Columns in the saved layout that no longer exist. */
  droppedColumns: string[];
};

export const runExport = async ({
  config,
  organizationId,
  userId,
  rowLimit = EXPORT_ROW_LIMIT,
}: {
  config: TExportConfig;
  organizationId: number;
  userId: number;
  rowLimit?: number;
}): Promise<ExportResult> => {
  const dataset = getDataset(config.datasetId);
  if (!dataset) {
    throw new Error(`Unknown export dataset: ${config.datasetId}`);
  }

  const filters: ParsedFilters = new Map(config.filters.map((filter) => [filter.id, filter.value]));

  const [{ rows, total }, catalogueColumns] = await Promise.all([
    dataset.fetch({ organizationId, userId, filters, limit: rowLimit }),
    dataset.columns({ organizationId }),
  ]);

  const readers = new Map(catalogueColumns.map((column) => [column.key, column]));

  const notes: string[] = [];

  // Attach the reference tables. Each runs once over the whole result set.
  const prepared = new Map<string, PreparedJoin<unknown>>();
  for (const joinConfig of config.joins) {
    const join = getJoin(dataset, joinConfig.id);
    if (!join) {
      notes.push(`The "${joinConfig.id}" reference table no longer exists; its columns are blank.`);
      continue;
    }

    const result = await join.prepare({ organizationId, rows, options: joinConfig.options });
    prepared.set(joinConfig.alias, result);

    for (const note of result.notes) {
      notes.push(`${join.label} (${joinConfig.alias}): ${note}`);
    }
  }

  // Resolve each configured column to something that can read a row.
  const columns: ResolvedColumn[] = [];
  const resolvers: ((row: unknown) => ExportValue)[] = [];
  const droppedColumns: string[] = [];

  for (const column of config.columns) {
    const { source, path } = parseColumnKey(column.key);

    if (source === 'const') {
      const value = column.value ?? '';
      columns.push({ key: column.key, label: column.label, type: 'text' });
      resolvers.push(() => value);
      continue;
    }

    if (source === 'join') {
      // `join:<alias>.<column>` — the alias may itself contain no dot, so split
      // on the first one only.
      const dot = path.indexOf('.');
      const alias = dot === -1 ? path : path.slice(0, dot);
      const joinColumnKey = dot === -1 ? '' : path.slice(dot + 1);
      const joined = prepared.get(alias);

      if (!joined || joinColumnKey === '') {
        droppedColumns.push(column.key);
        continue;
      }

      const definition = joined.columns.find((c) => c.key === joinColumnKey);
      columns.push({ key: column.key, label: column.label, type: definition?.type ?? 'text' });
      resolvers.push((row) => joined.resolve(row)[joinColumnKey] ?? null);
      continue;
    }

    // `field:` and `ocr:` both live in the dataset catalogue under their full key.
    const definition = readers.get(column.key);
    if (!definition) {
      droppedColumns.push(column.key);
      continue;
    }

    columns.push({ key: column.key, label: column.label, type: definition.type });
    resolvers.push(definition.read);
  }

  if (columns.length === 0) {
    throw new Error('None of the selected columns exist any more.');
  }

  if (droppedColumns.length > 0) {
    notes.push(
      `${droppedColumns.length} column(s) in this layout no longer exist and were skipped: ${droppedColumns.join(', ')}.`,
    );
  }

  const truncated = total > rows.length;
  if (truncated) {
    notes.push(
      `${total.toLocaleString()} rows matched the filters but only the first ${rows.length.toLocaleString()} were written — the export is capped at ${rowLimit.toLocaleString()} rows. Narrow the filters to see the rest.`,
    );
  }

  const values = rows.map((row) => resolvers.map((read) => read(row)));

  return {
    datasetLabel: dataset.label,
    columns,
    rows: values,
    rowCount: rows.length,
    totalMatching: total,
    truncated,
    notes,
    droppedColumns,
  };
};
