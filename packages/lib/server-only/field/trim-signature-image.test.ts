import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { findInkBounds, padInkBounds, trimSignatureImage } from './trim-signature-image';

vi.mock('../../utils/logger', () => ({
  buildLogger: () => ({ log: vi.fn(), error: vi.fn() }),
}));

const PREFIX = 'data:image/png;base64,';

/** A rectangle of ink. `alpha` is 0–255 and defaults to solid. */
type Box = { left: number; top: number; width: number; height: number; alpha?: number };

type Colour = { r: number; g: number; b: number };

const BLACK: Colour = { r: 0, g: 0, b: 0 };

/** A transparent canvas with rectangles of ink drawn on it, as a PNG data URL. */
const canvasWithInk = async (
  width: number,
  height: number,
  ink: Box[],
  colour: Colour = BLACK,
) => {
  const canvas = sharp({
    create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  });

  const layers = ink.map((box) => ({
    input: {
      create: {
        width: box.width,
        height: box.height,
        channels: 4 as const,
        background: { ...colour, alpha: (box.alpha ?? 255) / 255 },
      },
    },
    left: box.left,
    top: box.top,
  }));

  const png = await (layers.length > 0 ? canvas.composite(layers) : canvas).png().toBuffer();

  return `${PREFIX}${png.toString('base64')}`;
};

const decode = async (dataUrl: string) =>
  await sharp(Buffer.from(dataUrl.slice(PREFIX.length), 'base64'))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

const sizeOf = async (dataUrl: string) => {
  const { info } = await decode(dataUrl);

  return { width: info.width, height: info.height };
};

const inkOf = async (dataUrl: string) => {
  const { data, info } = await decode(dataUrl);

  return findInkBounds({
    data,
    width: info.width,
    height: info.height,
    channels: info.channels,
  });
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('findInkBounds', () => {
  it('finds the smallest box around what is drawn', () => {
    // 4×3 RGBA, drawn at (1,1) and (2,1).
    const data = new Uint8Array(4 * 3 * 4);
    data[(1 * 4 + 1) * 4 + 3] = 255;
    data[(1 * 4 + 2) * 4 + 3] = 255;

    expect(findInkBounds({ data, width: 4, height: 3, channels: 4 })).toEqual({
      left: 1,
      top: 1,
      width: 2,
      height: 1,
    });
  });

  it('spans every mark, however far apart', () => {
    const data = new Uint8Array(10 * 10 * 4);
    data[(1 * 10 + 2) * 4 + 3] = 255;
    data[(8 * 10 + 7) * 4 + 3] = 255;

    expect(findInkBounds({ data, width: 10, height: 10, channels: 4 })).toEqual({
      left: 2,
      top: 1,
      width: 6,
      height: 8,
    });
  });

  it('returns null when nothing is drawn', () => {
    const data = new Uint8Array(5 * 5 * 4);

    expect(findInkBounds({ data, width: 5, height: 5, channels: 4 })).toBeNull();
  });

  it('reads alpha as the last channel, so grey plus alpha works too', () => {
    // 3×2, two channels per pixel; drawn at (2,1).
    const data = new Uint8Array(3 * 2 * 2);
    data[(1 * 3 + 2) * 2 + 1] = 255;

    expect(findInkBounds({ data, width: 3, height: 2, channels: 2 })).toEqual({
      left: 2,
      top: 1,
      width: 1,
      height: 1,
    });
  });

  it('does not count a faint speck as ink', () => {
    const data = new Uint8Array(6 * 6 * 4);
    data[(5 * 6 + 5) * 4 + 3] = 6;
    data[(2 * 6 + 2) * 4 + 3] = 255;

    expect(findInkBounds({ data, width: 6, height: 6, channels: 4 })).toEqual({
      left: 2,
      top: 2,
      width: 1,
      height: 1,
    });
  });
});

describe('padInkBounds', () => {
  it('adds a little room on every side, in proportion to the signature', () => {
    // 300 × 2% = 6, which beats the 4px minimum.
    expect(padInkBounds({ left: 400, top: 150, width: 300, height: 100 }, 960, 420)).toEqual({
      left: 394,
      top: 144,
      width: 312,
      height: 112,
    });
  });

  it('keeps the minimum room around a small mark', () => {
    expect(padInkBounds({ left: 50, top: 50, width: 10, height: 10 }, 200, 200)).toEqual({
      left: 46,
      top: 46,
      width: 18,
      height: 18,
    });
  });

  it('never leaves the image', () => {
    expect(padInkBounds({ left: 0, top: 0, width: 10, height: 10 }, 100, 100)).toEqual({
      left: 0,
      top: 0,
      width: 14,
      height: 14,
    });

    expect(padInkBounds({ left: 90, top: 90, width: 10, height: 10 }, 100, 100)).toEqual({
      left: 86,
      top: 86,
      width: 14,
      height: 14,
    });
  });
});

describe('trimSignatureImage', () => {
  it('crops a signature to its ink plus the margin', async () => {
    const image = await canvasWithInk(960, 420, [{ left: 400, top: 150, width: 300, height: 100 }]);

    const trimmed = await trimSignatureImage(image);

    expect(trimmed.startsWith(PREFIX)).toBe(true);
    expect(await sizeOf(trimmed)).toEqual({ width: 312, height: 112 });
  });

  it('keeps the signature itself exactly as drawn', async () => {
    const image = await canvasWithInk(960, 420, [{ left: 400, top: 150, width: 300, height: 100 }]);

    // Same ink, same size, now sitting at the margin instead of mid-canvas.
    expect(await inkOf(await trimSignatureImage(image))).toEqual({
      left: 6,
      top: 6,
      width: 300,
      height: 100,
    });
  });

  it('keeps every stroke, including ones far apart', async () => {
    const image = await canvasWithInk(960, 420, [
      { left: 100, top: 60, width: 40, height: 40 },
      { left: 800, top: 300, width: 40, height: 40 },
    ]);

    // The strokes span 740 × 280; the margin is 2% of the longer side, 15px.
    expect(await sizeOf(await trimSignatureImage(image))).toEqual({
      width: 740 + 2 * 15,
      height: 280 + 2 * 15,
    });
  });

  it('does not change the colour of the ink', async () => {
    const image = await canvasWithInk(
      400,
      200,
      [{ left: 100, top: 80, width: 120, height: 40 }],
      { r: 0, g: 0, b: 255 },
    );

    const { data, info } = await decode(await trimSignatureImage(image));
    const margin = 4;
    const firstInkPixel = (margin * info.width + margin) * info.channels;

    expect([...data.slice(firstInkPixel, firstInkPixel + 4)]).toEqual([0, 0, 255, 255]);
  });

  it('is not held open by a faint speck in a far corner', async () => {
    const image = await canvasWithInk(960, 420, [
      { left: 400, top: 150, width: 300, height: 100 },
      { left: 950, top: 410, width: 1, height: 1, alpha: 5 },
    ]);

    expect(await sizeOf(await trimSignatureImage(image))).toEqual({ width: 312, height: 112 });
  });

  it('is held open by the same speck once it is solid', async () => {
    // The control for the case above: only its faintness is being ignored.
    const image = await canvasWithInk(960, 420, [
      { left: 400, top: 150, width: 300, height: 100 },
      { left: 950, top: 410, width: 1, height: 1 },
    ]);

    expect((await sizeOf(await trimSignatureImage(image))).width).toBeGreaterThan(500);
  });

  it('hands back the very same string when there is nothing to cut', async () => {
    // Ink to every edge: a signature that already fills its image.
    const full = await canvasWithInk(200, 80, [{ left: 0, top: 0, width: 200, height: 80 }]);

    expect(await trimSignatureImage(full)).toBe(full);
  });

  it('hands back the very same string when nothing is drawn', async () => {
    const blank = await canvasWithInk(200, 80, []);

    expect(await trimSignatureImage(blank)).toBe(blank);
  });

  it('leaves typed signatures and other image types alone', async () => {
    expect(await trimSignatureImage('Jane Doe')).toBe('Jane Doe');
    expect(await trimSignatureImage('')).toBe('');
    expect(await trimSignatureImage('data:image/jpeg;base64,/9j/4AAQ')).toBe(
      'data:image/jpeg;base64,/9j/4AAQ',
    );
  });

  it('hands back the original rather than failing when the image cannot be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const notAnImage = `${PREFIX}${Buffer.from('this is not a png').toString('base64')}`;

    expect(await trimSignatureImage(notAnImage)).toBe(notAnImage);
  });
});
