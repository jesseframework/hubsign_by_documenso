import { PDFDocument } from 'pdf-lib';

/**
 * Page count for a Smart OCR (BMS ML) submission — BMS ML's own response
 * never reports how many pages it processed (confirmed against its full
 * response shape), so this is the only source of truth for page-based
 * metering, computed before the upload call rather than after.
 *
 * Not just for PDFs — BMS ML also accepts single-page image formats
 * (png/jpg/tiff), which count as one page each. A corrupt/unparseable PDF
 * still gets sent to BMS ML (that's BMS ML's problem to reject, not ours to
 * pre-empt) and is charged the conservative minimum of 1 page rather than
 * blocking on a count we can't produce.
 */
export const getPdfPageCount = async (fileBuffer: Buffer, fileName: string): Promise<number> => {
  if (!/\.pdf$/i.test(fileName)) {
    return 1;
  }

  try {
    const pdf = await PDFDocument.load(fileBuffer, { ignoreEncryption: true });

    return Math.max(pdf.getPageCount(), 1);
  } catch {
    return 1;
  }
};
