import { PDFDocument } from 'pdf-lib';

/**
 * Merges multiple PDF files into a single PDF document.
 * Works in both browser and Node.js environments.
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
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await PDFDocument.load(arrayBuffer);
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());

    for (const page of pages) {
      mergedPdf.addPage(page);
    }
  }

  const mergedBytes = await mergedPdf.save();
  const mergedBlob = new Blob([mergedBytes], { type: 'application/pdf' });

  // Use the first file's name as the merged document name
  const baseName = files[0].name.replace(/\.pdf$/i, '');
  const mergedName = files.length > 1 ? `${baseName} (+${files.length - 1} merged).pdf` : files[0].name;

  return new File([mergedBlob], mergedName, { type: 'application/pdf' });
}
