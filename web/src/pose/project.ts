/**
 * Maps normalised landmarks onto the pixels the viewer is actually looking at.
 *
 * Simpler than the React Native path: MediaPipe takes the whole video frame,
 * so there is no square crop and no sensor rotation to undo. What remains is
 * the CSS `object-fit: cover` the preview uses, plus the horizontal flip that
 * makes a front-facing camera behave like a mirror.
 */
import type { Vec2 } from '@shared/utils/math';

export interface ViewProjection {
  /** Intrinsic video size, from `videoWidth` / `videoHeight`. */
  videoWidth: number;
  videoHeight: number;
  /** On-screen size of the preview element, in CSS pixels. */
  viewWidth: number;
  viewHeight: number;
  /** True when the preview is mirrored, as it is for a selfie camera. */
  mirrored: boolean;
}

/**
 * The scale and offset `object-fit: cover` applies.
 *
 * Exported so the snapshot compositor can reuse the exact same numbers - a
 * saved image that cropped differently from the preview would put the garment
 * somewhere the wearer never saw it.
 */
export function coverTransform(p: ViewProjection): {
  scale: number;
  offsetX: number;
  offsetY: number;
} {
  if (p.videoWidth <= 0 || p.videoHeight <= 0) {
    return { scale: 1, offsetX: 0, offsetY: 0 };
  }
  const scale = Math.max(p.viewWidth / p.videoWidth, p.viewHeight / p.videoHeight);
  return {
    scale,
    offsetX: (p.viewWidth - p.videoWidth * scale) / 2,
    offsetY: (p.viewHeight - p.videoHeight * scale) / 2,
  };
}

/** Normalised [0,1] landmark -> CSS pixels inside the preview element. */
export function projectToView(nx: number, ny: number, p: ViewProjection): Vec2 {
  const { scale, offsetX, offsetY } = coverTransform(p);
  const x = nx * p.videoWidth * scale + offsetX;
  const y = ny * p.videoHeight * scale + offsetY;
  return { x: p.mirrored ? p.viewWidth - x : x, y };
}

/** VIEW pixels back to normalised video space - the inverse of `projectToView`. */
export function viewToNormalized(x: number, y: number, p: ViewProjection): Vec2 {
  const { scale, offsetX, offsetY } = coverTransform(p);
  const vx = p.mirrored ? p.viewWidth - x : x;
  return {
    x: (vx - offsetX) / (p.videoWidth * scale),
    y: (y - offsetY) / (p.videoHeight * scale),
  };
}

/** A normalised horizontal distance in video space, as VIEW pixels. */
export function normalizedWidthToView(width: number, p: ViewProjection): number {
  return width * p.videoWidth * coverTransform(p).scale;
}
