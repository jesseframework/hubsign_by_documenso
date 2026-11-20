import sharp from 'sharp';

import { buildLogger } from '../../utils/logger';

/**
 * Cut the empty margin off a captured signature.
 *
 * The signature pad hands over its whole canvas, and a hand-drawn signature
 * rarely fills it: the canvas is a 16:7 rectangle and people sign across the
 * middle of it. That image is then fitted into the field the sender drew, so the
 * margins eat the size — "100% of the field" is still only the ink in the middle
 * of a mostly empty picture, small and thin in a large field however large the
 * signer asks for it.
 *
 * Cropping to the ink makes every size mean what it says: at 100% it is the
 * signature, not its canvas, that fills the field.
 *
 * This runs where the image is stored rather than where it is drawn. One place
 * then covers the signing page, the embeds and direct templates, and a signature
 * already on file keeps exactly the geometry it was signed with.
 *
 * It only ever crops. Colour, strokes and alpha are untouched, and anything it
 * cannot read comes back unchanged: a signature that is slightly smaller than it
 * could be is better than a signing that fails.
 */

const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

/**
 * Alpha at or below this counts as empty, on a 0–255 scale.
 *
 * Not zero: the faint fringe of an anti-aliased stroke, or a speck left behind
 * when the paper is removed from a photographed signature, would otherwise hold
 * the crop open out to the far corner of the image.
 */
const EMPTY_ALPHA_MAX = 16;

/** Room kept around the ink so a stroke never sits exactly on the image's edge. */
const MIN_PADDING_PX = 4;
const PADDING_RATIO = 0.02;

/** Decoded size ceiling, so one huge upload cannot exhaust memory on this path. */
const MAX_INPUT_PIXELS = 16_000_000;

export type InkBounds = { left: number; top: number; width: number; height: number };

/**
 * The smallest box holding every pixel that is not empty, or null when nothing at
 * all has been drawn.
 *
 * `data` is raw pixel data as sharp lays it out, with alpha as the last channel of
 * each pixel: 2 channels for grey plus alpha, 4 for RGBA.
 */
export const findInkBounds = ({
  data,
  width,
  height,
  channels,
}: {
  data: ArrayLike<number>;
  width: number;
  height: number;
  channels: number;
}): InkBounds | null => {
  const alphaOffset = channels - 1;

  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    const rowStart = y * width * channels;

    for (let x = 0; x < width; x += 1) {
      if (data[rowStart + x * channels + alphaOffset] > EMPTY_ALPHA_MAX) {
        if (x < minX) {
          minX = x;
        }

        if (x > maxX) {
          maxX = x;
        }

        if (y < minY) {
          minY = y;
        }

        if (y > maxY) {
          maxY = y;
        }
      }
    }
  }

  if (maxX < 0) {
    return null;
  }

  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
};

/** Grow the box by a little breathing room, without leaving the image. */
export const padInkBounds = (
  ink: InkBounds,
  imageWidth: number,
  imageHeight: number,
): InkBounds => {
  const padding = Math.max(
    MIN_PADDING_PX,
    Math.round(Math.max(ink.width, ink.height) * PADDING_RATIO),
  );

  const left = Math.max(0, ink.left - padding);
  const top = Math.max(0, ink.top - padding);
  const right = Math.min(imageWidth, ink.left + ink.width + padding);
  const bottom = Math.min(imageHeight, ink.top + ink.height + padding);

  return { left, top, width: right - left, height: bottom - top };
};

/**
 * Crop a signature image, given as a PNG data URL, to the ink it contains.
 *
 * Returns the very same string when there is nothing to do — not a PNG data URL,
 * nothing drawn, nothing to cut — and when anything goes wrong.
 */
export const trimSignatureImage = async (value: string): Promise<string> => {
  if (!value.startsWith(PNG_DATA_URL_PREFIX)) {
    return value;
  }

  try {
    const input = Buffer.from(value.slice(PNG_DATA_URL_PREFIX.length), 'base64');

    const { data, info } = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    // The scan below indexes 8-bit pixels. Anything laid out differently is not
    // worth guessing about.
    if (data.length !== info.width * info.height * info.channels) {
      return value;
    }

    const ink = findInkBounds({
      data,
      width: info.width,
      height: info.height,
      channels: info.channels,
    });

    if (!ink) {
      return value;
    }

    const crop = padInkBounds(ink, info.width, info.height);

    if (crop.width === info.width && crop.height === info.height) {
      return value;
    }

    const cropped = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS })
      .extract(crop)
      .png()
      .toBuffer();

    return `${PNG_DATA_URL_PREFIX}${cropped.toString('base64')}`;
  } catch (err) {
    console.error(err);

    buildLogger().error(err instanceof Error ? err : new Error(String(err)), {
      method: 'trimSignatureImage',
    });

    return value;
  }
};
