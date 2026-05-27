import sharp from 'sharp';

import { AppError, AppErrorCode } from '../../errors/app-error';

export const STAMP_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const STAMP_MIN_DIM = 32;
export const STAMP_MAX_DIM = 2000;
export const STAMP_ALLOWED_MIME = ['image/png', 'image/jpeg', 'image/svg+xml'] as const;

export type ValidatedStampAsset = {
  /** Re-encoded PNG bytes (EXIF stripped, raster only) — safe to store + render. */
  png: Buffer;
  width: number;
  height: number;
};

/**
 * Validate, sanitize, and normalize a stamp asset before persisting it. Always
 * returns a flat PNG so we never trust user-supplied SVG / JPEG metadata at
 * render time. Throws AppError on any policy violation.
 *
 * - PNG / JPEG: re-encoded through sharp, EXIF stripped
 * - SVG: rasterized via sharp (which uses librsvg) so any embedded scripts
 *   or external image refs are dropped — the output is a flattened raster.
 */
export const validateAndNormalizeStampAsset = async (
  bytes: Buffer,
  mime: string,
): Promise<ValidatedStampAsset> => {
  if (bytes.byteLength > STAMP_MAX_BYTES) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'Stamp file is too large (max 2 MB).',
    });
  }

  if (!STAMP_ALLOWED_MIME.includes(mime as (typeof STAMP_ALLOWED_MIME)[number])) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: 'Stamp must be PNG, JPEG, or SVG.',
    });
  }

  let pipeline = sharp(bytes, { failOn: 'error' });
  const meta = await pipeline.metadata();

  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  if (
    width < STAMP_MIN_DIM ||
    height < STAMP_MIN_DIM ||
    width > STAMP_MAX_DIM ||
    height > STAMP_MAX_DIM
  ) {
    throw new AppError(AppErrorCode.INVALID_BODY, {
      message: `Stamp dimensions must be between ${STAMP_MIN_DIM}px and ${STAMP_MAX_DIM}px on each side.`,
    });
  }

  // Re-encode to PNG with metadata stripped. sharp's default behaviour drops
  // EXIF, IPTC, XMP, and ICC unless explicitly retained — exactly what we want.
  const png = await pipeline.png({ compressionLevel: 9 }).toBuffer();

  return { png, width, height };
};
