/**
 * Which markup tool the pointer is currently holding. `none` is the cursor —
 * markup mode is on, but a click lands on the document rather than drawing.
 *
 * There is no freehand pen on purpose: a hand-drawn stroke on a signing page
 * reads as a signature to anyone looking at the finished document while
 * carrying none of a signature's authentication or audit trail.
 */
export type AnnotationTool = 'none' | 'highlight' | 'note';

/** A point in the stored coordinate space: percent of the page, origin top-left. */
export type AnnotationPoint = {
  x: number;
  y: number;
};
