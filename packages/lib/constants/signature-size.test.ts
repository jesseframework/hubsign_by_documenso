import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SIGNATURE_FILL,
  MAX_SIGNATURE_FILL,
  MAX_SIGNATURE_UPSCALE,
  MIN_SIGNATURE_FILL,
  SIGNATURE_SIZE_PRESETS,
  clampSignatureFill,
  signatureImageScale,
  signatureSizePresetOf,
} from './signature-size';

/** A field 300×100, and a signature captured 1200×400 — the usual proportions. */
const field = { fieldWidth: 300, fieldHeight: 100 };
const large = { imageWidth: 1200, imageHeight: 400 };
/** A signature captured smaller than its field, which the old code never grew. */
const small = { imageWidth: 150, imageHeight: 50 };

describe('signatureImageScale', () => {
  it('reproduces the old behaviour exactly when no size was chosen', () => {
    // The guarantee that matters: a document signed before this feature must not
    // change shape the next time it is sealed.
    expect(signatureImageScale({ ...large, ...field, fill: null })).toBe(0.25);
    // Fit is 2 here, and the old formula capped at 1 — never enlarging.
    expect(signatureImageScale({ ...small, ...field, fill: null })).toBe(1);
    expect(signatureImageScale({ ...small, ...field, fill: undefined })).toBe(1);
  });

  it('fills the field at 1', () => {
    expect(signatureImageScale({ ...large, ...field, fill: 1 })).toBe(0.25);
    // And unlike the old formula, it does grow a small signature to fit.
    expect(signatureImageScale({ ...small, ...field, fill: 1 })).toBe(2);
  });

  it('scales proportionally below 1', () => {
    expect(signatureImageScale({ ...large, ...field, fill: 0.6 })).toBeCloseTo(0.15);
    expect(signatureImageScale({ ...large, ...field, fill: 0.8 })).toBeCloseTo(0.2);
  });

  it('goes past the field above 1, centred on it', () => {
    // Fit is 0.25 here, so 1.5 draws the signature at 1.5× what just fills the field.
    expect(signatureImageScale({ ...large, ...field, fill: 1.5 })).toBeCloseTo(0.375);

    // And the largest size, XXL, at twice it.
    const scale = signatureImageScale({ ...large, ...field, fill: MAX_SIGNATURE_FILL });

    expect(scale).toBeCloseTo(0.5);
    expect(large.imageWidth * scale).toBeGreaterThan(field.fieldWidth);
    expect(large.imageHeight * scale).toBeGreaterThan(field.fieldHeight);
  });

  it('constrains by the tighter axis, so a signature never overflows its field', () => {
    // A tall image in a wide field: height is the binding constraint.
    const scale = signatureImageScale({
      imageWidth: 400,
      imageHeight: 800,
      ...field,
      fill: 1,
    });

    expect(400 * scale).toBeLessThanOrEqual(field.fieldWidth);
    expect(800 * scale).toBeLessThanOrEqual(field.fieldHeight);
  });

  it('stops enlarging before the pixels show', () => {
    // A tiny signature in a big field would otherwise be blown up without limit.
    const scale = signatureImageScale({
      imageWidth: 10,
      imageHeight: 4,
      ...field,
      fill: 1,
    });

    expect(scale).toBe(MAX_SIGNATURE_UPSCALE);
  });

  it('clamps a fill that arrived out of range instead of trusting it', () => {
    const huge = signatureImageScale({ ...large, ...field, fill: 12 });
    expect(huge).toBe(signatureImageScale({ ...large, ...field, fill: MAX_SIGNATURE_FILL }));

    const tiny = signatureImageScale({ ...large, ...field, fill: -3 });
    expect(tiny).toBe(signatureImageScale({ ...large, ...field, fill: MIN_SIGNATURE_FILL }));
  });
});

describe('clampSignatureFill', () => {
  it('keeps values inside the accepted range', () => {
    expect(clampSignatureFill(0.5)).toBe(0.5);
    expect(clampSignatureFill(1.2)).toBe(1.2);
    expect(clampSignatureFill(2)).toBe(2);
    expect(clampSignatureFill(0)).toBe(MIN_SIGNATURE_FILL);
    expect(clampSignatureFill(99)).toBe(MAX_SIGNATURE_FILL);
  });
});

describe('SIGNATURE_SIZE_PRESETS', () => {
  it('only offers sizes the server accepts', () => {
    // The signing page sends the preset's fraction as it stands. A button whose
    // size the range rejects would fail on every click, which is the same bug the
    // first version of this control shipped with.
    for (const preset of SIGNATURE_SIZE_PRESETS) {
      expect(clampSignatureFill(preset.fill)).toBe(preset.fill);
    }
  });

  it('lists them smallest first, and includes the default', () => {
    const fills = SIGNATURE_SIZE_PRESETS.map((preset) => preset.fill);

    expect(fills).toEqual([...fills].sort((a, b) => a - b));
    expect(fills).toContain(DEFAULT_SIGNATURE_FILL);
  });

  it('puts the largest preset at the ceiling', () => {
    expect(Math.max(...SIGNATURE_SIZE_PRESETS.map((preset) => preset.fill))).toBe(
      MAX_SIGNATURE_FILL,
    );
  });
});

describe('signatureSizePresetOf', () => {
  it('reports the nearest preset, so the right button shows as selected', () => {
    expect(signatureSizePresetOf(0.6).key).toBe('S');
    expect(signatureSizePresetOf(0.8).key).toBe('M');
    expect(signatureSizePresetOf(1).key).toBe('L');
    expect(signatureSizePresetOf(1.5).key).toBe('XL');
    expect(signatureSizePresetOf(1.4).key).toBe('XL');
    expect(signatureSizePresetOf(1.7).key).toBe('XL');
    expect(signatureSizePresetOf(1.8).key).toBe('XXL');
    expect(signatureSizePresetOf(2).key).toBe('XXL');
    expect(signatureSizePresetOf(1.1).key).toBe('L');
    // A stored value between presets — from an older tuning or a hand-made
    // request — still lights one of them rather than none.
    expect(signatureSizePresetOf(0.72).key).toBe('M');
    expect(signatureSizePresetOf(0.31).key).toBe('S');
  });

  it('treats a signature with no stored size as the default', () => {
    expect(signatureSizePresetOf(null).fill).toBe(DEFAULT_SIGNATURE_FILL);
    expect(signatureSizePresetOf(undefined).key).toBe('M');
  });
});
