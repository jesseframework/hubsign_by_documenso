import fontkit from '@pdf-lib/fontkit';
import type { DocumentAnnotation } from '@prisma/client';
import { DocumentAnnotationType } from '@prisma/client';
import type { PDFDocument, PDFFont, PDFPage } from 'pdf-lib';
import { BlendMode, RotationTypes, StandardFonts, degrees, radiansToDegrees, rgb } from 'pdf-lib';

import { prisma } from '@documenso/prisma';

import { NEXT_PUBLIC_WEBAPP_URL } from '../../constants/app';

/**
 * Draw every annotation on a document onto the in-memory PDF, so markup ends up
 * as page content in the sealed PDF rather than as editable annotation objects
 * — the seal path runs `flattenAnnotations` earlier to strip exactly that kind
 * of layer before signing, so anything left as a real PDF annotation would not
 * survive the trip.
 *
 * Called from BOTH seal paths, alongside `embedStampsOnPdf`: the job handler in
 * jobs/definitions/internal/seal-document.handler.ts (what actually runs when a
 * document completes) and `sealDocument` in document/seal-document.ts. They are
 * parallel copies of one pipeline, and wiring only one is how stamps came to be
 * silently missing from every sealed PDF.
 *
 * As with stamps, a failure on one annotation is logged and skipped. Markup is
 * commentary on a document; it must never be the reason a document someone
 * signed fails to complete.
 */
export const embedAnnotationsOnPdf = async (
  doc: PDFDocument,
  documentId: number,
): Promise<void> => {
  const annotations = await prisma.documentAnnotation.findMany({
    where: { documentId },
    // Oldest first, so later markup paints over earlier markup in the same
    // order the browser overlay stacked it.
    orderBy: { createdAt: 'asc' },
  });

  if (annotations.length === 0) return;

  const pages = doc.getPages();

  // Only pay for a font when there is text to set with it.
  const font = annotations.some((annotation) => annotation.type === DocumentAnnotationType.NOTE)
    ? await embedNoteFont(doc)
    : null;

  for (const annotation of annotations) {
    try {
      const page = pages[annotation.pageIndex];

      if (!page) continue;

      const geometry = getPageGeometry(page);

      switch (annotation.type) {
        case DocumentAnnotationType.HIGHLIGHT:
          drawHighlight(page, annotation, geometry);
          break;

        case DocumentAnnotationType.NOTE:
          if (font) {
            drawNote(page, annotation, geometry, font);
          }
          break;
      }
    } catch (err) {
      console.error(
        `[annotations] failed to draw annotation ${annotation.id} on document ${documentId}:`,
        err,
      );
    }
  }
};

/**
 * The rendered dimensions of a page and how far it is turned.
 *
 * A page carrying /Rotate 90 or 270 renders in the browser with its width and
 * height swapped, and annotations were drawn against what the browser showed.
 * Working in that swapped space and mapping back at draw time is the same
 * approach `insertFieldInPDF` takes for field placement.
 */
type PageGeometry = {
  width: number;
  height: number;
  rotation: number;
};

const getPageGeometry = (page: PDFPage): PageGeometry => {
  const pageRotation = page.getRotation();

  const rotationInDegrees =
    pageRotation.type === RotationTypes.Radians
      ? radiansToDegrees(pageRotation.angle)
      : pageRotation.angle;

  // Round to the closest multiple of 90, and normalise into [0, 360).
  const rotation = (((Math.round(rotationInDegrees / 90) * 90) % 360) + 360) % 360;

  let { width, height } = page.getSize();

  if (rotation === 90 || rotation === 270) {
    [width, height] = [height, width];
  }

  return { width, height, rotation };
};

/**
 * Rotate a point expressed in the rendered page's coordinate system back into
 * the unrotated page's own coordinate system.
 */
const applyRotation = (x: number, y: number, geometry: PageGeometry): { x: number; y: number } => {
  if (geometry.rotation === 90) {
    return { x: geometry.height - y, y: x };
  }

  if (geometry.rotation === 270) {
    return { x: y, y: geometry.width - x };
  }

  if (geometry.rotation === 180) {
    return { x: geometry.width - x, y: geometry.height - y };
  }

  return { x, y };
};

/**
 * The lower-left corner of a stored rectangle, in PDF user space. Paired with
 * `rotate: degrees(rotation)` on the draw call, which turns the rectangle about
 * that corner so it lands square on a rotated page.
 */
const toPdfRect = (annotation: DocumentAnnotation, geometry: PageGeometry) => {
  const width = (annotation.width / 100) * geometry.width;
  const height = (annotation.height / 100) * geometry.height;

  const { x, y } = applyRotation(
    (annotation.x / 100) * geometry.width,
    geometry.height - (annotation.y / 100) * geometry.height - height,
    geometry,
  );

  return { x, y, width, height };
};

/** `#RRGGBB` to a pdf-lib colour, falling back to yellow on anything odd. */
const hexToRgb = (hex: string) => {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());

  if (!match) return rgb(0.98, 0.8, 0.08);

  const value = parseInt(match[1], 16);

  return rgb(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
};

const drawHighlight = (
  page: PDFPage,
  annotation: DocumentAnnotation,
  geometry: PageGeometry,
): void => {
  const rect = toPdfRect(annotation, geometry);

  page.drawRectangle({
    ...rect,
    color: hexToRgb(annotation.color),
    opacity: annotation.opacity,
    // Multiply is what makes this read as a highlighter rather than a sticker:
    // the text underneath darkens through the colour instead of being covered.
    blendMode: BlendMode.Multiply,
    rotate: degrees(geometry.rotation),
  });
};

const NOTE_PADDING_RATIO = 0.06;
const NOTE_LINE_HEIGHT_RATIO = 1.25;

const drawNote = (
  page: PDFPage,
  annotation: DocumentAnnotation,
  geometry: PageGeometry,
  font: PDFFont,
): void => {
  const text = annotation.text?.trim();

  if (!text) return;

  const rect = toPdfRect(annotation, geometry);
  const color = hexToRgb(annotation.color);

  // A tinted card rather than an opaque one — a note dropped over a table
  // should still let you see which row it is about.
  page.drawRectangle({
    ...rect,
    color: rgb(1, 1, 1),
    opacity: 0.92,
    borderColor: color,
    borderWidth: 1,
    borderOpacity: annotation.opacity,
    rotate: degrees(geometry.rotation),
  });

  const fontSize = Math.max(
    annotation.fontSize ? (annotation.fontSize / 100) * geometry.height : 9,
    4,
  );

  const padding = Math.max(rect.height * NOTE_PADDING_RATIO, fontSize * 0.4);
  const lineHeight = fontSize * NOTE_LINE_HEIGHT_RATIO;
  const maxLines = Math.max(Math.floor((rect.height - padding * 2) / lineHeight), 1);

  const lines = wrapText(text, font, fontSize, rect.width - padding * 2).slice(0, maxLines);

  // Positions are built in the rendered page's frame (top-left origin, which is
  // how the note was laid out in the browser) and mapped through the same
  // rotation as everything else.
  const noteLeft = (annotation.x / 100) * geometry.width + padding;
  const noteTop = (annotation.y / 100) * geometry.height + padding;

  lines.forEach((line, index) => {
    // drawText anchors at the baseline, so drop by roughly the ascender to get
    // the first line inside the card rather than straddling its top edge.
    const baselineFromTop = noteTop + index * lineHeight + fontSize * 0.8;

    const position = applyRotation(noteLeft, geometry.height - baselineFromTop, geometry);

    page.drawText(line, {
      x: position.x,
      y: position.y,
      size: fontSize,
      font,
      color: rgb(0.1, 0.1, 0.12),
      rotate: degrees(geometry.rotation),
    });
  });
};

/** Greedy word wrap, breaking mid-word only when a single word cannot fit. */
const wrapText = (text: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  if (maxWidth <= 0) return [];

  const widthOf = (value: string) => {
    try {
      return font.widthOfTextAtSize(value, size);
    } catch {
      // A glyph the font cannot encode should cost us one wrapped line, not the
      // whole seal. Assume a conservative average width instead.
      return value.length * size * 0.6;
    }
  };

  const lines: string[] = [];

  for (const paragraph of text.split(/\r?\n/)) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }

    let current = '';

    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;

      if (widthOf(candidate) <= maxWidth) {
        current = candidate;
        continue;
      }

      if (current) {
        lines.push(current);
        current = '';
      }

      // A single word wider than the card — chip characters off it until the
      // remainder fits rather than letting it run off the edge.
      let remainder = word;

      while (widthOf(remainder) > maxWidth && remainder.length > 1) {
        let cut = remainder.length - 1;

        while (cut > 1 && widthOf(remainder.slice(0, cut)) > maxWidth) {
          cut--;
        }

        lines.push(remainder.slice(0, cut));
        remainder = remainder.slice(cut);
      }

      current = remainder;
    }

    if (current) lines.push(current);
  }

  return lines;
};

/**
 * Notes are free text, so they get Noto — the same font the field renderer uses
 * — because the standard PDF fonts can only encode WinAnsi and would throw on
 * the first non-Latin character someone types. Helvetica is the fallback if the
 * font cannot be fetched; losing accents beats losing the seal.
 */
const embedNoteFont = async (doc: PDFDocument): Promise<PDFFont> => {
  try {
    const fontBytes = await fetch(`${NEXT_PUBLIC_WEBAPP_URL()}/fonts/noto-sans.ttf`).then(
      async (res) => res.arrayBuffer(),
    );

    doc.registerFontkit(fontkit);

    return await doc.embedFont(fontBytes);
  } catch (err) {
    console.error('[annotations] falling back to Helvetica for note text:', err);

    return await doc.embedFont(StandardFonts.Helvetica);
  }
};
