import type { DocumentData } from '@prisma/client';

import { getFile } from '../universal/upload/get-file';

type PrintPDFProps = {
  documentData: DocumentData;
  /**
   * If set, slice this many trailing pages off the sealed PDF before printing.
   * Mirrors `downloadPDF`'s param so callers can offer the same with /
   * without-cert toggle for both download and print.
   */
  stripTrailingPages?: number;
};

/**
 * Open the sealed (or stripped) PDF in a new tab and trigger the browser's
 * native print dialog as soon as the viewer reports the file is loaded.
 *
 * Why a new tab and not a hidden iframe: most browsers refuse `window.print()`
 * inside iframes that load a Blob URL of `application/pdf` — the embedded PDF
 * viewer is sandboxed and `contentWindow.print()` either no-ops or prints the
 * empty host frame. A new tab gives Chrome / Safari / Firefox / Edge their
 * built-in PDF viewer, which all reliably honor the trigger.
 */
export const printPDF = async ({ documentData, stripTrailingPages = 0 }: PrintPDFProps) => {
  const bytes = await getFile({
    type: documentData.type,
    data: documentData.data,
  });

  let pdfBytes: Uint8Array | ArrayBuffer = bytes;

  if (stripTrailingPages > 0) {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.load(bytes);
    const total = pdf.getPageCount();
    const keep = Math.max(1, total - stripTrailingPages);
    for (let i = total - 1; i >= keep; i--) {
      pdf.removePage(i);
    }
    pdfBytes = await pdf.save();
  }

  const blob = new Blob([pdfBytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);

  // We open before navigation to avoid the popup blocker — most browsers
  // allow window.open if it's the direct result of a click handler.
  const printWindow = window.open(url, '_blank');
  if (!printWindow) {
    // Popup blocked — fall back to navigating the current tab. The user
    // can still hit Cmd/Ctrl+P themselves.
    window.location.href = url;
    return;
  }

  // Once the PDF is loaded, fire the print dialog. `load` fires on the
  // host page, then the embedded PDF viewer renders. Small delay gives
  // the viewer enough time to finish painting before the dialog opens.
  printWindow.addEventListener('load', () => {
    setTimeout(() => {
      try {
        printWindow.focus();
        printWindow.print();
      } catch {
        // user can still print manually from the toolbar
      }
    }, 250);

    // Revoke the blob URL after the user has had a chance to see the
    // print dialog — too eager and Safari cancels the load.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  });
};
