import type { DocumentData } from '@prisma/client';

import { getFile } from '../universal/upload/get-file';
import { downloadFile } from './download-file';

type DocumentVersion = 'original' | 'signed';

type DownloadPDFProps = {
  documentData: DocumentData;
  fileName?: string;
  /**
   * Specifies which version of the document to download.
   * 'signed': Downloads the signed version (default).
   * 'original': Downloads the original version.
   */
  version?: DocumentVersion;
  /**
   * If set, slice this many trailing pages off the sealed PDF before
   * downloading. Used to offer "download without audit certificate" — at
   * seal time we record how many pages the cert occupies on
   * `Document.certificatePageCount`, and the caller forwards that here when
   * the user picks the no-certificate option.
   */
  stripTrailingPages?: number;
};

export const downloadPDF = async ({
  documentData,
  fileName,
  version = 'signed',
  stripTrailingPages = 0,
}: DownloadPDFProps) => {
  const bytes = await getFile({
    type: documentData.type,
    data: version === 'signed' ? documentData.data : documentData.initialData,
  });

  let pdfBytes: Uint8Array | ArrayBuffer = bytes;

  // Lazy-load pdf-lib only when we actually need to strip pages so the cost
  // is paid by the small minority of users who pick the "no cert" option.
  if (stripTrailingPages > 0) {
    const { PDFDocument } = await import('pdf-lib');
    const pdf = await PDFDocument.load(bytes);
    const total = pdf.getPageCount();
    const keep = Math.max(1, total - stripTrailingPages);
    // Remove pages from the end. pdf-lib's removePage is index-based, so
    // delete the highest indices first to keep earlier indices valid.
    for (let i = total - 1; i >= keep; i--) {
      pdf.removePage(i);
    }
    pdfBytes = await pdf.save();
  }

  const blob = new Blob([pdfBytes], {
    type: 'application/pdf',
  });

  const baseTitle = (fileName ?? 'document').replace(/\.pdf$/, '');
  const suffix = version === 'signed' ? '_signed.pdf' : '.pdf';

  downloadFile({
    filename: `${baseTitle}${suffix}`,
    data: blob,
  });
};
