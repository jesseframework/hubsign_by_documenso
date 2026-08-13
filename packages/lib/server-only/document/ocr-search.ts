import { prisma } from '@documenso/prisma';

/**
 * Documents whose OCR extraction contains the search term.
 *
 * The E-Sign list shows the vendor, invoice number and PO number that OCR read
 * off a document (see `findDocuments`), and a value you can see is a value you
 * expect to be able to search. Title and recipient matching alone meant typing a
 * PO number that is displayed on screen returned nothing.
 *
 * Done in SQL rather than by loading extractions and reusing the inbox's
 * `ocrSearchText`: this list is paginated server-side, so a match has to be part
 * of the same `WHERE` that produces the page and the count. Two consequences
 * worth knowing:
 *
 *   - `jsonb_each_text` walks the top-level entries and compares their *values*,
 *     not their keys. The inbox's client-side filter also matches keys, so it
 *     treats "invoice" as a hit on anything carrying an invoice field; here that
 *     would match nearly every extraction and make the term useless. Nested
 *     objects and line-item arrays still match, because at the top level they
 *     come back as their JSON text.
 *   - There is no index behind it. At today's volumes the sequential scan over
 *     one small table is nothing; if the inbox grows into six figures this wants
 *     a `pg_trgm` GIN index on the extraction, or a maintained search column.
 *
 * Scoping is deliberately absent: callers fold the returned ids into a search
 * `OR` that is itself `AND`ed with the visibility and deleted-state filters, so a
 * document the reader may not see cannot be surfaced by matching here.
 */
export const documentIdsMatchingOcr = async (query: string): Promise<number[]> => {
  const term = query.trim();

  // A bare `%%` matches every extraction, which would quietly turn "no search"
  // into "every document that ever went through OCR".
  if (term === '') {
    return [];
  }

  const rows = await prisma.$queryRaw<{ documentId: number }[]>`
    SELECT DISTINCT i."documentId"
    FROM (
      SELECT "documentId", "extractedData"
      FROM "SignatureInboxItem"
      WHERE "extractedData" IS NOT NULL
        -- jsonb_each_text raises on a scalar or an array; an extraction should
        -- always be an object, but one malformed row must not fail every search.
        AND jsonb_typeof("extractedData") = 'object'
    ) i,
    jsonb_each_text(i."extractedData") kv
    WHERE kv.value ILIKE ${`%${term}%`}
  `;

  return rows.map((row) => row.documentId);
};
