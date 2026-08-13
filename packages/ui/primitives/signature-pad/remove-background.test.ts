import { describe, expect, it } from 'vitest';

import { removeSignatureBackground } from './remove-background';

/** Build an RGBA buffer from a grid of [r,g,b,a] tuples. */
const rgba = (pixels: number[][]): Uint8ClampedArray =>
  new Uint8ClampedArray(pixels.flatMap(([r, g, b, a]) => [r, g, b, a ?? 255]));

/** A page of paper with a few pixels of ink on it. */
const page = ({
  paper,
  ink,
  inkPixels = 6,
  total = 100,
}: {
  paper: number[];
  ink: number[];
  inkPixels?: number;
  total?: number;
}): Uint8ClampedArray =>
  rgba([
    ...Array.from({ length: inkPixels }, () => ink),
    ...Array.from({ length: total - inkPixels }, () => paper),
  ]);

const alphaAt = (data: Uint8ClampedArray, index: number): number => data[index * 4 + 3];

describe('removeSignatureBackground', () => {
  it('cuts white paper away and keeps black ink', () => {
    const data = page({ paper: [255, 255, 255], ink: [10, 10, 10] });
    const result = removeSignatureBackground(data);

    expect(result.applied).toBe(true);
    expect(result.backgroundIsLight).toBe(true);
    expect(alphaAt(data, 0)).toBe(255); // ink
    expect(alphaAt(data, 50)).toBe(0); // paper
  });

  it('handles the dingy grey paper a phone photograph produces', () => {
    // Paper at 188, ink at 70 — a fixed "anything above 240 is white" rule leaves
    // the whole page behind.
    const data = page({ paper: [188, 186, 180], ink: [70, 72, 90] });
    const result = removeSignatureBackground(data);

    expect(result.applied).toBe(true);
    expect(alphaAt(data, 0)).toBe(255);
    expect(alphaAt(data, 50)).toBe(0);
  });

  it('keeps the ink colour, changing only alpha', () => {
    const data = page({ paper: [252, 250, 245], ink: [24, 40, 160] });
    removeSignatureBackground(data);

    // A blue pen is still blue afterwards.
    expect([data[0], data[1], data[2]]).toEqual([24, 40, 160]);
  });

  it('removes a dark background rather than the light ink on it', () => {
    // The majority class is the background whichever side it falls on, so this
    // does not need a special case — and without that rule the signature itself
    // would be erased.
    const data = page({ paper: [20, 20, 24], ink: [240, 240, 240] });
    const result = removeSignatureBackground(data);

    expect(result.applied).toBe(true);
    expect(result.backgroundIsLight).toBe(false);
    expect(alphaAt(data, 0)).toBe(255); // the pale ink survives
    expect(alphaAt(data, 50)).toBe(0); // the dark page goes
  });

  it('leaves an already-transparent PNG alone', () => {
    const data = rgba([
      ...Array.from({ length: 10 }, () => [10, 10, 10, 255]),
      ...Array.from({ length: 90 }, () => [0, 0, 0, 0]),
    ]);
    const before = new Uint8ClampedArray(data);

    const result = removeSignatureBackground(data);

    expect(result).toMatchObject({ applied: false, skipped: 'already-transparent' });
    expect(data).toEqual(before);
  });

  it('leaves a flat image alone rather than erasing all of it', () => {
    const data = page({ paper: [200, 200, 200], ink: [203, 203, 203] });
    const before = new Uint8ClampedArray(data);

    const result = removeSignatureBackground(data);

    expect(result).toMatchObject({ applied: false, skipped: 'no-separation' });
    expect(data).toEqual(before);
  });

  it('reports an empty buffer instead of dividing by nothing', () => {
    expect(removeSignatureBackground(new Uint8ClampedArray(0))).toMatchObject({
      applied: false,
      skipped: 'empty',
    });
  });

  it('fades the edge instead of stepping, so a stroke keeps its shape', () => {
    // A pixel sitting between ink and paper — the anti-aliased edge of a stroke.
    const data = rgba([
      ...Array.from({ length: 5 }, () => [0, 0, 0]),
      [128, 128, 128],
      ...Array.from({ length: 94 }, () => [255, 255, 255]),
    ]);

    removeSignatureBackground(data);

    const edge = alphaAt(data, 5);
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });

  it('takes more away as sensitivity rises', () => {
    const shareRemoved = (sensitivity: number) => {
      const data = rgba([
        ...Array.from({ length: 5 }, () => [0, 0, 0]),
        ...Array.from({ length: 15 }, () => [150, 150, 150]),
        ...Array.from({ length: 80 }, () => [250, 250, 250]),
      ]);

      return removeSignatureBackground(data, { sensitivity }).removed ?? 0;
    };

    expect(shareRemoved(-50)).toBeLessThan(shareRemoved(50));
  });
});
