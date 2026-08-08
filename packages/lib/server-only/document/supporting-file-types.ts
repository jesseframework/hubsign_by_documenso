/**
 * What a signer is allowed to attach to a document, and how that is decided.
 *
 * THE THREAT
 *
 * This upload is reachable with only a signing token — no account — and whatever
 * lands here is later downloaded by staff on their own machines. A `.exe`, `.js`
 * or `.lnk` arriving as "supporting documentation" and being opened by someone
 * expecting a purchase order is the whole risk.
 *
 * Archives (`.zip`, `.rar`, `.7z`) are refused for the same reason even though
 * they are not directly executable: their contents can't be inspected here, so
 * allowing them would reduce this allow-list to a formality.
 *
 * WHY THREE CHECKS
 *
 * Extension alone is trivially renamed. The browser-supplied `Content-Type` is
 * attacker-controlled — it is a claim, not evidence. So an accepted file must:
 *
 *   1. carry an allowed extension,
 *   2. carry a declared MIME type consistent with that extension, and
 *   3. begin with the magic bytes its format actually requires.
 *
 * The third is what makes it more than paperwork: `payload.exe` renamed to
 * `invoice.pdf` still starts `MZ`, not `%PDF-`, and is refused.
 */

export const MAX_SUPPORTING_FILE_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_SUPPORTING_FILES_PER_RECIPIENT = 10;

type AllowedType = {
  extensions: string[];
  /** Declared MIME types accepted for these extensions. */
  mimeTypes: string[];
  /**
   * Leading byte signatures. Any one matching is enough.
   * Omitted for formats with no reliable signature (plain text, CSV).
   */
  magic?: number[][];
};

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // Also OOXML: docx/xlsx are zips.
const ZIP_EMPTY = [0x50, 0x4b, 0x05, 0x06];
const ZIP_SPANNED = [0x50, 0x4b, 0x07, 0x08];
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]; // Legacy doc/xls.

const ALLOWED_TYPES: AllowedType[] = [
  {
    extensions: ['pdf'],
    mimeTypes: ['application/pdf'],
    magic: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  },
  {
    extensions: ['doc', 'xls'],
    mimeTypes: ['application/msword', 'application/vnd.ms-excel'],
    magic: [OLE_MAGIC],
  },
  {
    extensions: ['docx', 'xlsx'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    // OOXML files ARE zip containers, so the signature is a zip signature. That
    // is why `.zip` is excluded by EXTENSION rather than by magic bytes — the
    // two are indistinguishable at the header.
    magic: [ZIP_MAGIC, ZIP_EMPTY, ZIP_SPANNED],
  },
  {
    extensions: ['png'],
    mimeTypes: ['image/png'],
    magic: [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  },
  {
    extensions: ['jpg', 'jpeg'],
    mimeTypes: ['image/jpeg'],
    magic: [[0xff, 0xd8, 0xff]],
  },
  {
    extensions: ['gif'],
    mimeTypes: ['image/gif'],
    magic: [
      [0x47, 0x49, 0x46, 0x38, 0x37, 0x61],
      [0x47, 0x49, 0x46, 0x38, 0x39, 0x61],
    ],
  },
  {
    extensions: ['webp'],
    mimeTypes: ['image/webp'],
    // RIFF....WEBP — bytes 8-11 are checked separately below.
    magic: [[0x52, 0x49, 0x46, 0x46]],
  },
  {
    extensions: ['tif', 'tiff'],
    mimeTypes: ['image/tiff'],
    magic: [
      [0x49, 0x49, 0x2a, 0x00],
      [0x4d, 0x4d, 0x00, 0x2a],
    ],
  },
  {
    extensions: ['csv', 'txt'],
    mimeTypes: ['text/csv', 'text/plain', 'application/csv'],
    // No signature exists for plain text; the extension + a control-byte scan
    // below is the best available check.
  },
];

/** Accept-attribute value for the file input. */
export const SUPPORTING_FILE_ACCEPT = ALLOWED_TYPES.flatMap((t) =>
  t.extensions.map((e) => `.${e}`),
).join(',');

export const SUPPORTING_FILE_EXTENSIONS = ALLOWED_TYPES.flatMap((t) => t.extensions);

const extensionOf = (fileName: string): string => {
  const parts = fileName.toLowerCase().split('.');

  return parts.length > 1 ? (parts.pop() ?? '') : '';
};

const startsWith = (bytes: Uint8Array, signature: number[]): boolean =>
  signature.every((byte, i) => bytes[i] === byte);

/**
 * Strips directory components and anything that could confuse a download header
 * or a filesystem. Keeps the extension, which the caller has already validated.
 */
export const sanitizeSupportingFileName = (raw: string): string => {
  // Take the basename only — "../../etc/passwd" and "C:\evil.pdf" both collapse.
  const base = raw.split(/[\\/]/).pop() ?? 'attachment';

  const cleaned = base
    // Control characters, quotes, semicolons and newlines can all break a
    // Content-Disposition header.
    .replace(/[\u0000-\u001f\u007f"'\\;\r\n]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return (cleaned || 'attachment').slice(0, 200);
};

export type SupportingFileVerdict =
  | { ok: true; extension: string; contentType: string }
  | { ok: false; reason: string };

/**
 * @param bytes the first bytes of the file — at least 16 are needed for the
 * longest signature and the WEBP sub-check.
 */
export const validateSupportingFile = ({
  fileName,
  declaredType,
  sizeBytes,
  bytes,
}: {
  fileName: string;
  declaredType: string;
  sizeBytes: number;
  bytes: Uint8Array;
}): SupportingFileVerdict => {
  if (sizeBytes <= 0) {
    return { ok: false, reason: 'The file is empty.' };
  }

  if (sizeBytes > MAX_SUPPORTING_FILE_BYTES) {
    const mb = Math.round(MAX_SUPPORTING_FILE_BYTES / (1024 * 1024));

    return { ok: false, reason: `Files must be ${mb} MB or smaller.` };
  }

  const extension = extensionOf(fileName);

  if (!extension) {
    return { ok: false, reason: 'The file needs an extension so its type can be checked.' };
  }

  const match = ALLOWED_TYPES.find((t) => t.extensions.includes(extension));

  if (!match) {
    return {
      ok: false,
      reason: `".${extension}" files aren't accepted. Allowed: ${SUPPORTING_FILE_EXTENSIONS.join(', ')}.`,
    };
  }

  // A mismatched declaration is a signal in its own right, so it's rejected
  // rather than ignored — but it is never the ONLY check, because it's a claim.
  const declared = (declaredType || '').toLowerCase().split(';')[0].trim();

  if (declared && !match.mimeTypes.includes(declared)) {
    return {
      ok: false,
      reason: `The file's type (${declared}) doesn't match its ".${extension}" extension.`,
    };
  }

  if (match.magic) {
    const signatureMatched = match.magic.some((sig) => startsWith(bytes, sig));

    if (!signatureMatched) {
      return {
        ok: false,
        reason: `This file's contents aren't a valid ".${extension}" file. It may have been renamed.`,
      };
    }

    // RIFF is shared by WAV/AVI, so confirm the WEBP form specifically.
    if (extension === 'webp') {
      const isWebp = [0x57, 0x45, 0x42, 0x50].every((byte, i) => bytes[8 + i] === byte);

      if (!isWebp) {
        return { ok: false, reason: "This file isn't a valid WebP image." };
      }
    }
  } else {
    // Plain text: reject NUL and most control bytes, which no real .txt/.csv has
    // and which every binary payload does.
    const looksBinary = bytes
      .slice(0, 16)
      .some((byte) => byte === 0 || (byte < 0x09 && byte !== 0x00) || (byte > 0x0d && byte < 0x20));

    if (looksBinary) {
      return { ok: false, reason: `This doesn't look like a text ".${extension}" file.` };
    }
  }

  return {
    ok: true,
    extension,
    // The verified type, derived from the extension we checked — never the
    // client's declaration.
    contentType: match.mimeTypes[match.extensions.indexOf(extension)] ?? match.mimeTypes[0],
  };
};
