import { getSession } from '@documenso/auth/server/lib/utils/get-session';
import { buildWorkbook } from '@documenso/lib/server-only/export/build-workbook';
import { resolveOrgMembership } from '@documenso/lib/server-only/organization/resolve-org-membership';
import { runExport } from '@documenso/lib/server-only/export/run-export';
import { ZExportConfigSchema } from '@documenso/lib/types/export';

import type { Route } from './+types/export';

/**
 * Generate a spreadsheet and hand it back as a download.
 *
 * A resource route rather than a tRPC procedure: tRPC serialises through
 * SuperJSON, so a workbook returned that way would arrive base64'd inside a
 * JSON envelope and have to be decoded in the browser. Here the bytes are the
 * response body.
 *
 * It is also why the export is generated server-side at all rather than from
 * the rows the grid already holds — the grid caps at 100 rows and filters what
 * it has in the browser, so "export what you see" would quietly export a page.
 */

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Keep the filename to something every filesystem and header parser accepts. */
const safeFilename = (value: string) =>
  value
    .replace(/[^a-zA-Z0-9 ._-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[.-]+/, '')
    .slice(0, 80) || 'export';

export const action = async ({ request }: Route.ActionArgs) => {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // `getSession` throws rather than redirecting on /api/ paths, and an uncaught
  // throw here surfaces as a 500 HTML page instead of a 401.
  const session = await getSession(request).catch(() => null);

  if (!session?.user) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const membership = await resolveOrgMembership(session.user.id);

  if (!membership) {
    return json({ error: 'You are not a member of an organization.' }, 403);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Expected a JSON body.' }, 400);
  }

  const parsed = ZExportConfigSchema.safeParse(payload);

  if (!parsed.success) {
    return json({ error: 'Invalid export configuration.', issues: parsed.error.issues }, 400);
  }

  const generatedAt = new Date();

  try {
    const result = await runExport({
      config: parsed.data,
      organizationId: membership.organizationId,
      userId: session.user.id,
    });

    const workbook = await buildWorkbook({
      result,
      sheetName: parsed.data.sheetName,
      generatedBy: session.user.email,
      generatedAt,
      filterSummary: summariseFilters(parsed.data),
    });

    const filename = `${safeFilename(parsed.data.sheetName || result.datasetLabel)}-${generatedAt
      .toISOString()
      .slice(0, 10)}.xlsx`;

    return new Response(new Uint8Array(workbook), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': String(workbook.byteLength),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=0, no-store',
        // Read by the browser so it can report what actually came back without
        // having to parse the workbook.
        'X-Export-Rows': String(result.rowCount),
        'X-Export-Total': String(result.totalMatching),
        'X-Export-Truncated': result.truncated ? '1' : '0',
      },
    });
  } catch (error) {
    console.error('[api/export] Failed to build export:', error);

    return json(
      { error: error instanceof Error ? error.message : 'Failed to build the export.' },
      500,
    );
  }
};

/** Human-readable record of what was filtered, written into the workbook. */
const summariseFilters = (config: { filters: { id: string; value: unknown }[] }): string[] => {
  const lines: string[] = [];

  for (const filter of config.filters) {
    const value = filter.value as
      | { kind: 'text'; value: string }
      | { kind: 'select'; value: string[] }
      | { kind: 'dateRange'; from: string | null; to: string | null }
      | { kind: 'numberRange'; min: number | null; max: number | null };

    switch (value.kind) {
      case 'text':
        if (value.value.trim() !== '') lines.push(`${filter.id}: contains "${value.value}"`);
        break;
      case 'select':
        if (value.value.length > 0) lines.push(`${filter.id}: ${value.value.join(', ')}`);
        break;
      case 'dateRange':
        if (value.from || value.to) {
          lines.push(`${filter.id}: ${value.from ?? 'any'} to ${value.to ?? 'any'}`);
        }
        break;
      case 'numberRange':
        if (value.min !== null || value.max !== null) {
          lines.push(`${filter.id}: ${value.min ?? 'any'} to ${value.max ?? 'any'}`);
        }
        break;
    }
  }

  return lines;
};
