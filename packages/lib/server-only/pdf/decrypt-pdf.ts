import { PdfPasswordRequiredError } from '../../universal/pdf-errors';

/**
 * Removes the encryption dictionary from a PDF that opens without a password.
 *
 * Plenty of PDFs handed to us — government forms, bank statements, anything run
 * through a scanner's "protect" setting — carry an owner password that only
 * restricts editing. Viewers open them fine, but `pdf-lib` (which the whole app
 * merges, seals and stamps with) refuses to touch them: it has no decryption
 * support at all, so `PDFDocument.load` throws, and `ignoreEncryption: true`
 * only trades that error for a parse failure on the still-encrypted objects.
 *
 * MuPDF can read them, so we graft every page into a fresh document and save
 * that. The output keeps the vector text — nothing is rasterized — but document
 * level structure that doesn't belong to a page (AcroForm field hierarchy,
 * outlines) is dropped, which is what we want for a document about to be
 * flattened and signed anyway.
 */
export const decryptPdf = async (pdf: Uint8Array): Promise<Uint8Array> => {
  const mupdf = await import('mupdf');

  const source = new mupdf.PDFDocument(pdf);

  // A real user password is a different problem — we can't guess it, and the
  // caller should tell the user to unlock the file themselves.
  if (source.needsPassword()) {
    source.destroy();

    throw new PdfPasswordRequiredError();
  }

  const target = new mupdf.PDFDocument();

  try {
    for (let pageIndex = 0; pageIndex < source.countPages(); pageIndex++) {
      target.graftPage(pageIndex, source, pageIndex);
    }

    const buffer = target.saveToBuffer('compress');

    try {
      // Copy out of the WASM heap before it's freed underneath us.
      return buffer.asUint8Array().slice();
    } finally {
      buffer.destroy();
    }
  } finally {
    target.destroy();
    source.destroy();
  }
};
