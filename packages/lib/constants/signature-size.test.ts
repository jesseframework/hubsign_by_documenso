import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SIGNATURE_FILL,
  MAX_SIGNATURE_UPSCALE,
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
    expect(huge).toBe(signatureImageScale({ ...large, ...field, fill: 1 }));

    const tiny = signatureImageScale({ ...large, ...field, fill: -3 });
    expect(tiny).toBe(signatureImageScale({ ...large, ...field, fill: 0.3 }));
  });
});

describe('clampSignatureFill', () => {
  it('keeps values inside the accepted range', () => {
    expect(clampSignatureFill(0.5)).toBe(0.5);
    expect(clampSignatureFill(0)).toBe(0.3);
    expect(clampSignatureFill(99)).toBe(1);
  });
});

describe('signatureSizePresetOf', () => {
  it('reports the nearest preset, so the right button shows as selected', () => {
    expect(signatureSizePresetOf(0.6).key).toBe('S');
    expect(signatureSizePresetOf(0.8).key).toBe('M');
    expect(signatureSizePresetOf(1).key).toBe('L');
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
