import type { AnyExportDataset, CatalogueColumn, ExportFilterDef, ExportJoinDef } from './types';
import { signatureInboxDataset } from './datasets/signature-inbox';

/**
 * Every grid that can be exported.
 *
 * Adding one is a single entry here plus its dataset module — the builder
 * dialog, the column catalogue, the joins, the spreadsheet writer and the saved
 * templates are all written against the dataset contract and need no changes.
 */
const DATASETS: AnyExportDataset[] = [signatureInboxDataset];

export const listDatasets = () =>
  DATASETS.map((dataset) => ({
    id: dataset.id,
    label: dataset.label,
    description: dataset.description,
  }));

export const getDataset = (id: string): AnyExportDataset | null =>
  DATASETS.find((dataset) => dataset.id === id) ?? null;

export type ExportCatalogue = {
  datasetId: string;
  label: string;
  description: string;
  groupOrder: string[];
  columns: CatalogueColumn[];
  filters: ExportFilterDef[];
  joins: {
    id: string;
    label: string;
    matchDescription: string;
    options: ExportFilterDef[];
  }[];
};

/**
 * Everything the builder needs to draw itself for one organization.
 *
 * Joined columns are deliberately NOT included: attaching a reference table
 * costs a query and a fuzzy match over the whole directory, so its columns are
 * fetched only once the user actually attaches it (`catalogueForJoin`).
 */
export const buildCatalogue = async (
  dataset: AnyExportDataset,
  organizationId: number,
): Promise<ExportCatalogue> => {
  const [columns, filters] = await Promise.all([
    dataset.columns({ organizationId }),
    dataset.filters({ organizationId }),
  ]);

  return {
    datasetId: dataset.id,
    label: dataset.label,
    description: dataset.description,
    groupOrder: dataset.groupOrder,
    columns: columns.map(({ read: _read, ...column }) => column),
    filters,
    joins: dataset.joins.map((join) => ({
      id: join.id,
      label: join.label,
      matchDescription: join.matchDescription,
      options: join.options ?? [],
    })),
  };
};

export const getJoin = (dataset: AnyExportDataset, joinId: string): ExportJoinDef | null =>
  dataset.joins.find((join) => join.id === joinId) ?? null;
