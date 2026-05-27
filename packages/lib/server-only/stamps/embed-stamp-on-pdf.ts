import { StampKind } from '@prisma/client';
import { type PDFDocument, degrees } from 'pdf-lib';

import { prisma } from '@documenso/prisma';

import { getFileServerSide } from '../../universal/upload/get-file.server';

/**
 * Draw every stamp placement attached to the given document onto the in-memory
 * PDF. Called from seal-document.ts right before `flattenForm` so stamps end
 * up flattened into the final sealed PDF (not editable annotations).
 *
 * For Slice 1 we only render UPLOADED stamps. DESIGNED / AI_GENERATED stamps
 * land in Slice 2 once the server-side rasterizer is in place.
 *
 * Errors on a single placement are logged but never abort the seal — a broken
 * stamp shouldn't prevent the document from completing.
 */
export const embedStampsOnPdf = async (doc: PDFDocument, documentId: number): Promise<void> => {
  const placements = await prisma.documentStampPlacement.findMany({
    where: { documentId },
    include: { stamp: true },
    orderBy: { createdAt: 'asc' },
  });

  if (placements.length === 0) return;

  const pages = doc.getPages();

  for (const placement of placements) {
    try {
      const { stamp } = placement;
      // Both UPLOADED and AI_GENERATED stamps carry an imageAssetId (the AI
      // path rasterizes its SVG to PNG and persists it just like an upload).
      // Only DESIGNED stamps (canvas layout, no raster yet) need a different
      // path — that lands with the Slice 2 server-side rasterizer.
      if (!stamp.imageAssetId || stamp.kind === StampKind.DESIGNED) continue;

      const documentData = await prisma.documentData.findUnique({
        where: { id: stamp.imageAssetId },
      });
      if (!documentData) continue;

      const bytes = await getFileServerSide(documentData);

      // Validation already enforced PNG-or-JPEG-or-SVG-rasterized-to-PNG, but
      // pdf-lib can't introspect bytes without trying — try PNG first, fall
      // back to JPG so we cover both legitimate inputs.
      let image: Awaited<ReturnType<PDFDocument['embedPng']>>;
      try {
        image = await doc.embedPng(bytes);
      } catch {
        image = await doc.embedJpg(bytes);
      }

      const page = pages[placement.pageIndex];
      if (!page) continue;

      // Placement coords are stored as percentages of the page dimensions so
      // they're zoom-independent in the editor (matches how Field positions
      // work). pdf-lib uses PDF user space (origin lower-left), so we flip
      // Y and offset by the stamp's height to get the bottom edge.
      const { width: pageWidth, height: pageHeight } = page.getSize();
      const pdfX = (placement.x / 100) * pageWidth;
      const pdfW = (placement.width / 100) * pageWidth;
      const pdfH = (placement.height / 100) * pageHeight;
      const pdfY = pageHeight - (placement.y / 100) * pageHeight - pdfH;

      page.drawImage(image, {
        x: pdfX,
        y: pdfY,
        width: pdfW,
        height: pdfH,
        rotate: placement.rotation ? degrees(placement.rotation) : undefined,
        opacity: placement.opacity ?? 1,
      });
    } catch (err) {
      console.error(
        `[stamps] failed to draw placement ${placement.id} on document ${documentId}:`,
        err,
      );
    }
  }
};
