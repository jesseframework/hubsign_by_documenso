/**
 * Cut the paper away from a photographed or scanned signature.
 *
 * People sign a sheet of paper and photograph it. Dropped onto a document as-is,
 * that upload carries its page with it: a white — or worse, cream and unevenly
 * lit — rectangle that sits over whatever it lands on and looks exactly like what
 * it is, a photo stuck on a contract.
 *
 * The job is to decide, per pixel, "paper or ink". Two decisions make this work
 * on real photographs rather than only on clean scans:
 *
 *   1. **The threshold is measured, not fixed.** A scan's paper is near 250, a
 *      phone photo's is nearer 190, and a fixed cut-off that suits one erases the
 *      other's ink or leaves the other's paper behind. Otsu's method finds the
 *      split that best separates the two groups this image actually contains.
 *   2. **The majority class is the background.** A signature covers a few percent
 *      of its page, so whichever side of the threshold holds most of the pixels is
 *      the paper. That also makes white-ink-on-dark work without a special case,
 *      where a rule of "remove light pixels" would have erased the signature.
 *
 * Alpha is the only channel touched. A blue pen stays blue, because the colour of
 * a signature is sometimes the point of it.
 *
 * Pure, and operating on a plain RGBA array, so the decisions above can be tested
 * without a browser.
 */

/** Rec. 709 luma — matches how the eye weights the channels. */
const luminance = (r: number, g: number, b: number): number =>
  0.2126 * r + 0.7152 * g + 0.0722 * b;

/** Below this alpha a pixel is already invisible and tells us nothing. */
const OPAQUE_ENOUGH = 8;

/**
 * Width of the fade around the threshold, in luminance steps.
 *
 * Without it every edge pixel is either fully kept or fully cut, which turns the
 * anti-aliased edge of a pen stroke into a staircase. The band keeps partial
 * alpha through the transition, so the stroke keeps its shape.
 */
const SOFT_BAND = 28;

/**
 * Least separation between the two groups worth acting on.
 *
 * A photograph of nothing, a solid colour, or an image that is all ink has no
 * meaningful split, and thresholding it would either do nothing or erase
 * everything. Below this, the image is left exactly as it came in.
 */
const MIN_SEPARATION = 18;

/**
 * Share of pixels already transparent that means the file was cut out already.
 *
 * A signature exported as a transparent PNG is mostly nothing, and running this
 * over it can only make it worse — a pale stroke on no background would be read
 * as the background.
 */
const ALREADY_CUT_SHARE = 0.5;

export type RemoveBackgroundResult = {
  /** Whether any pixel was changed. False when the image was left alone. */
  applied: boolean;
  /** Why it was left alone, for the caller to say so. */
  skipped?: 'empty' | 'already-transparent' | 'no-separation';
  /** The luminance the split was made at. */
  threshold?: number;
  /** Fraction of visible pixels that became transparent. */
  removed?: number;
  /** Whether the background was the lighter of the two groups. */
  backgroundIsLight?: boolean;
};

export type RemoveBackgroundOptions = {
  /**
   * Nudges the measured threshold, -50 to +50.
   *
   * Positive takes more away — for a photo whose paper is dingy enough to sit
   * near the ink. Negative keeps more, for a faint pencil signature. The
   * measurement is right often enough that this stays at zero, but "often
   * enough" is not always, and re-photographing a signature is a poor answer.
   */
  sensitivity?: number;
};

/**
 * Make the background of an RGBA image transparent, in place.
 *
 * @param data RGBA bytes, four per pixel, as `ImageData.data` gives them.
 */
export const removeSignatureBackground = (
  data: Uint8ClampedArray,
  { sensitivity = 0 }: RemoveBackgroundOptions = {},
): RemoveBackgroundResult => {
  const pixels = Math.floor(data.length / 4);

  if (pixels === 0) {
    return { applied: false, skipped: 'empty' };
  }

  // Histogram over the pixels that are actually visible; transparent ones are
  // not evidence about anything.
  const histogram = new Array<number>(256).fill(0);
  let visible = 0;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= OPAQUE_ENOUGH) continue;

    histogram[Math.round(luminance(data[i], data[i + 1], data[i + 2]))] += 1;
    visible += 1;
  }

  if (visible === 0) {
    return { applied: false, skipped: 'empty' };
  }

  if (1 - visible / pixels >= ALREADY_CUT_SHARE) {
    return { applied: false, skipped: 'already-transparent' };
  }

  // ---- Otsu: the split that best separates the two groups -------------------
  let sum = 0;
  for (let level = 0; level < 256; level += 1) {
    sum += level * histogram[level];
  }

  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let threshold = 128;

  for (let level = 0; level < 256; level += 1) {
    backgroundWeight += histogram[level];
    if (backgroundWeight === 0) continue;

    const foregroundWeight = visible - backgroundWeight;
    if (foregroundWeight === 0) break;

    backgroundSum += level * histogram[level];

    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (sum - backgroundSum) / foregroundWeight;
    const variance =
      backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;

    if (variance > bestVariance) {
      bestVariance = variance;
      threshold = level;
    }
  }

  // How far apart the two groups' means actually are, which is the honest
  // measure of whether there are two groups at all.
  let darkWeight = 0;
  let darkSum = 0;
  let lightWeight = 0;
  let lightSum = 0;

  for (let level = 0; level < 256; level += 1) {
    if (level <= threshold) {
      darkWeight += histogram[level];
      darkSum += level * histogram[level];
    } else {
      lightWeight += histogram[level];
      lightSum += level * histogram[level];
    }
  }

  if (darkWeight === 0 || lightWeight === 0) {
    return { applied: false, skipped: 'no-separation' };
  }

  const separation = lightSum / lightWeight - darkSum / darkWeight;

  if (separation < MIN_SEPARATION) {
    return { applied: false, skipped: 'no-separation' };
  }

  // The paper is whichever group covers more of the image: a signature is a few
  // percent of the page it sits on. This is what makes white ink on a dark scan
  // work rather than being erased.
  const backgroundIsLight = lightWeight >= darkWeight;

  /*
    The fade is centred midway between what the two groups actually average, not
    on Otsu's boundary.

    Otsu's threshold is the top of the darker class, so in a clean two-tone image
    it lands *on* the ink: 10 for black-on-white. A band centred there erased half
    the alpha of every ink pixel — the signature came out at 50% opacity while the
    paper went correctly. The midpoint of the means sits in the empty space
    between the groups, where a fade belongs.
  */
  const midpoint = (darkSum / darkWeight + lightSum / lightWeight) / 2;

  // Positive sensitivity always removes more, whichever side the paper is on, so
  // the control means one thing rather than inverting with the image.
  const nudge = Math.max(-50, Math.min(50, sensitivity));
  const cut = Math.max(
    0,
    Math.min(255, backgroundIsLight ? midpoint - nudge : midpoint + nudge),
  );
  const half = SOFT_BAND / 2;

  let removed = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha <= OPAQUE_ENOUGH) continue;

    const lum = luminance(data[i], data[i + 1], data[i + 2]);
    // Distance into the background side of the split. Positive means "more
    // background-like than the cut", and the band either side fades rather than
    // steps.
    const towardsBackground = backgroundIsLight ? lum - cut : cut - lum;

    if (towardsBackground >= half) {
      data[i + 3] = 0;
      removed += 1;
      continue;
    }

    if (towardsBackground > -half) {
      const keep = (half - towardsBackground) / SOFT_BAND;
      data[i + 3] = Math.round(alpha * keep);
      if (data[i + 3] === 0) removed += 1;
    }
  }

  return {
    applied: true,
    threshold: cut,
    removed: removed / visible,
    backgroundIsLight,
  };
};
