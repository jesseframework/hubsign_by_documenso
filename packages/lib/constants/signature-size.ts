/**
 * How much of its field a signature fills.
 *
 * A signature is captured on a wide canvas and then fitted into whatever box the
 * sender drew, and the two rarely have the same shape. The result is routinely a
 * small, thin signature adrift in a large field — legible, but nothing like the
 * signature the person actually produced, and there was no way for the signer to
 * say so.
 *
 * Three presets rather than a slider. Signing is not the moment to offer fine
 * control over typography: the signer wants "that's too small", one click, done.
 *
 * The fraction is stored with the signature rather than the preset name, because
 * it is the geometry that was actually signed. Renaming or re-tuning a preset
 * later must not change how an already-signed document looks.
 */

export type SignatureSizePreset = {
  key: 'S' | 'M' | 'L';
  /** Fraction of the field the signature is fitted into, 0–1. */
  fill: number;
};

export const SIGNATURE_SIZE_PRESETS: SignatureSizePreset[] = [
  { key: 'S', fill: 0.6 },
  { key: 'M', fill: 0.8 },
  { key: 'L', fill: 1 },
];

/**
 * What a signature with no stored size uses.
 *
 * Medium, not large: a signature that touches every edge of its field looks
 * cramped, and the caption drawn beneath every signature needs the room.
 */
export const DEFAULT_SIGNATURE_FILL = 0.8;

/** Bounds accepted from a client, so a hand-made request cannot fill the page. */
export const MIN_SIGNATURE_FILL = 0.3;
export const MAX_SIGNATURE_FILL = 1;

/**
 * Ceiling on enlarging a signature beyond its captured size.
 *
 * A signature drawn small on the pad, or one whose transparent margins are most
 * of the image, has to be scaled up to fill its field — but past a point that is
 * enlarging pixels rather than the signature, and it prints as a blurred smear.
 * Three times is generous for the canvas resolution this app captures at.
 */
export const MAX_SIGNATURE_UPSCALE = 3;

/** The nearest preset to a stored fraction, for showing which one is selected. */
export const signatureSizePresetOf = (fill: number | null | undefined): SignatureSizePreset => {
  const target = fill ?? DEFAULT_SIGNATURE_FILL;

  return SIGNATURE_SIZE_PRESETS.reduce((closest, preset) =>
    Math.abs(preset.fill - target) < Math.abs(closest.fill - target) ? preset : closest,
  );
};

/** Clamp anything arriving from a client into the accepted range. */
export const clampSignatureFill = (fill: number): number =>
  Math.min(MAX_SIGNATURE_FILL, Math.max(MIN_SIGNATURE_FILL, fill));

/**
 * The factor to draw a signature image at inside its field.
 *
 * `fill` null means the signature was made before this existed: those keep the
 * old behaviour exactly — fit the field, never enlarge — so a document signed
 * last month does not change shape the next time it is sealed.
 */
export const signatureImageScale = ({
  imageWidth,
  imageHeight,
  fieldWidth,
  fieldHeight,
  fill,
}: {
  imageWidth: number;
  imageHeight: number;
  fieldWidth: number;
  fieldHeight: number;
  fill: number | null | undefined;
}): number => {
  const fit = Math.min(fieldWidth / imageWidth, fieldHeight / imageHeight);

  if (fill === null || fill === undefined) {
    return Math.min(fit, 1);
  }

  return Math.min(fit * clampSignatureFill(fill), MAX_SIGNATURE_UPSCALE);
};
