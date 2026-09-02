import { PDF_PASSWORD_REQUIRED_CODE, PdfPasswordRequiredError } from '../universal/pdf-errors';

export type UnlockPdfResult = {
  /** Bytes that `pdf-lib` can load — the originals unless we had to unlock them. */
  bytes: ArrayBuffer;
  /** True when the server had to rebuild the file — it was encrypted or damaged. */
  wasUnlocked: boolean;
};

/**
 * Returns a copy of the PDF that `pdf-lib` will actually open.
 *
 * Restricted PDFs — the owner-password kind that viewers open happily — render
 * fine in the browser because pdf.js decrypts them, but every pdf-lib call we
 * make on them throws, since pdf-lib can't decrypt anything. When that happens
 * we hand the file to `/api/files/decrypt-pdf`, which re-writes it unencrypted
 * with MuPDF, and carry on with the bytes it gives back.
 *
 * Browser only — it calls the app's API.
 */
export const unlockPdf = async (
  bytes: ArrayBuffer,
  fileName = 'document.pdf',
): Promise<UnlockPdfResult> => {
  const { PDFDocument } = await import('pdf-lib');

  try {
    // Parse a copy — the caller keeps using the original buffer.
    await PDFDocument.load(bytes.slice(0));

    return { bytes, wasUnlocked: false };
  } catch (loadError) {
    // Worth a try for any load failure, not just the encrypted ones: MuPDF also
    // repairs the malformed files pdf-lib gives up on.
    const unlocked = await requestUnlockedPdf(bytes, fileName, loadError);

    return { bytes: unlocked, wasUnlocked: true };
  }
};

const requestUnlockedPdf = async (
  bytes: ArrayBuffer,
  fileName: string,
  loadError: unknown,
): Promise<ArrayBuffer> => {
  const formData = new FormData();

  formData.append('file', new File([new Blob([bytes])], fileName, { type: 'application/pdf' }));

  const response = await fetch('/api/files/decrypt-pdf', {
    method: 'POST',
    body: formData,
  }).catch(() => null);

  if (!response || !response.ok) {
    const body = await response?.json().catch(() => null);

    if (body?.code === PDF_PASSWORD_REQUIRED_CODE) {
      throw new PdfPasswordRequiredError();
    }

    // Nothing better to say than what pdf-lib said in the first place.
    throw loadError;
  }

  return await response.arrayBuffer();
};
