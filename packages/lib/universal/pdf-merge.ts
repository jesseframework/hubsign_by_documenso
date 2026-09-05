import { PDFDocument } from 'pdf-lib';

import { unlockPdf } from '../client-only/unlock-pdf';

/**
 * Merges multiple PDF files into a single PDF document.
 *
 * Browser only — restricted PDFs are unlocked through the app's API before
 * merging, since pdf-lib refuses to load them.
 */
export async function mergePdfFiles(files: File[]): Promise<File> {
  if (files.length === 0) {
    throw new Error('No files provided');
  }

  if (files.length === 1) {
    return files[0];
  }

  const mergedPdf = await PDFDocument.create();

  for (const file of files) {
    const { bytes } = await unlockPdf(await file.arrayBuffer(), file.name);
    const pdf = await PDFDocument.load(bytes);
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

    for (const page of pages) {
      mergedPdf.addPage(page);
    }
  }

  const mergedBytes = await mergedPdf.save();
  const mergedBlob = new Blob([mergedBytes], { type: 'application/pdf' });

  // Use the first file's name as the merged document name
  const baseName = files[0].name.replace(/\.pdf$/i, '');
  const mergedName =
    files.length > 1 ? `${baseName} (+${files.length - 1} merged).pdf` : files[0].name;

  return new File([mergedBlob], mergedName, { type: 'application/pdf' });
}
