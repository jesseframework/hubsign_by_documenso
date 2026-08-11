import { prisma } from '@documenso/prisma';

import type { RuleFactProvider, RuleSubject } from '../types';

/**
 * Values the signer typed into the document's own fields.
 *
 * Without this a rule could see everything about a document except what the
 * person in front of it just entered. That made a blocking rule a dead end: a
 * "PO number required" rule reads OCR output, the OCR output is wrong, and
 * adding a PO field to the document changed nothing because no rule could see
 * it. Now it can, so the block becomes something the signer can actually clear.
 *
 * Paths are `fields.<slug>` where the slug comes from the field's label, and
 * `fields.byType.<TYPE>` for the raw list. Labels are author-controlled, so the
 * catalogue below can only describe the shape — the concrete paths depend on
 * the document, and the rule builder shows the generic entries.
 */

const documentIdOf = (subject: RuleSubject): number | null => {
  if (subject.entityType !== 'Document') return null;
  const id = Number(subject.entityId);

  return Number.isInteger(id) ? id : null;
};

/**
 * "PO Number" -> "po_number". Matches the convention OCR keys already use, so a
 * rule author writing `fields.po_number` alongside `ocr.po_number` gets the two
 * halves of the same idea spelled the same way.
 */
export const fieldSlug = (label: string): string =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/**
 * Field values arrive as strings. A numeric-looking one is offered as a number
 * as well so an ordering rule works — the evaluator coerces silently, and
 * `toNumber('1,200.00')` is 0, which would make a threshold rule quietly pass
 * every invoice it was written to catch.
 */
const numericOrNull = (raw: string): number | null => {
  const cleaned = raw.replace(/[^0-9.-]/g, '');
  if (!/\d/.test(cleaned)) return null;

  const parsed = Number(cleaned);

  return Number.isFinite(parsed) ? parsed : null;
};

export const fieldsProvider: RuleFactProvider = {
  namespace: 'fields',
  label: 'Signer-entered fields',
  fields: [
    {
      path: 'fields.filled',
      label: 'Number of fields the signer filled in',
      type: 'number',
    },
    {
      path: 'fields.labels',
      label: 'Labels of the filled fields',
      type: 'array',
      description: 'Use with the "in" operator to test that a named field was completed.',
    },
    {
      path: 'fields.<name>',
      label: 'A named field, e.g. fields.po_number',
      type: 'string',
      description:
        'The value the signer typed, keyed by the field label lowercased with underscores. "PO Number" becomes fields.po_number. Add "_number" for the numeric form, e.g. fields.amount_number.',
    },
  ],

  resolve: async (subject) => {
    const documentId = documentIdOf(subject);
    if (documentId === null) return undefined;

    const rows = await prisma.field
      .findMany({
        where: { documentId },
        select: { id: true, type: true, customText: true, fieldMeta: true },
      })
      .catch(() => []);

    const values: Record<string, unknown> = {};
    const labels: string[] = [];
    let filled = 0;

    for (const row of rows) {
      const text = (row.customText ?? '').trim();
      if (text === '') continue;

      filled += 1;

      const meta = (row.fieldMeta ?? {}) as { label?: unknown };
      // Fall back to the field type when the author gave no label, so an
      // unlabelled TEXT field is still reachable as `fields.text`.
      const rawLabel = typeof meta.label === 'string' && meta.label.trim() !== '' ? meta.label : row.type;
      const slug = fieldSlug(String(rawLabel));
      if (slug === '') continue;

      labels.push(slug);

      // First one wins. Two fields sharing a label is the author's ambiguity,
      // and silently overwriting would make the rule depend on row order.
      if (!(slug in values)) {
        values[slug] = text;

        const numeric = numericOrNull(text);
        if (numeric !== null) {
          values[`${slug}_number`] = numeric;
        }
      }
    }

    return {
      ...values,
      filled,
      labels,
    };
  },
};
