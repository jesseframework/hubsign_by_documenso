/**
 * Thrown when a PDF can't be opened without the password it was locked with.
 *
 * Unlike an owner password — which only restricts editing and which we can
 * strip ourselves — nothing can be read out of the file until the user supplies
 * this one, so the only useful answer is to ask them to unlock it first.
 */
export class PdfPasswordRequiredError extends Error {
  constructor() {
    super('This PDF needs a password to open.');

    this.name = 'PdfPasswordRequiredError';
  }
}

/** Wire code for {@link PdfPasswordRequiredError}, shared by the decrypt endpoint. */
export const PDF_PASSWORD_REQUIRED_CODE = 'PDF_PASSWORD_REQUIRED';
