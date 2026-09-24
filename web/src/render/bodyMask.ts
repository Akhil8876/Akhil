/**
 * Turns MediaPipe's segmentation mask into something a canvas can clip with.
 *
 * Without this the garment is a rectangle of fabric floating over the scene:
 * it spills past the wearer's outline onto the background, which is the single
 * most obvious tell that nothing is really being worn. Clipping to the
 * person's own silhouette is what makes it read as clothing.
 *
 * The mask arrives as one float per pixel at the model's own resolution, so it
 * is converted into an alpha-only bitmap once per detection and scaled at draw
 * time rather than per frame.
 */

export interface BodyMask {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
}

/**
 * Softens the mask edge by this many pixels. A hard cut looks cut out; a
 * little feathering reads as fabric meeting skin.
 */
const FEATHER_PX = 2;

/**
 * Below this the pixel is background. MediaPipe's mask is confident in the
 * middle and ramps at the edges, so the threshold mostly decides how tight
 * the silhouette is.
 */
const THRESHOLD = 0.35;

export function createBodyMask(width: number, height: number): BodyMask {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return { canvas, width, height };
}

/**
 * Writes one frame's mask into the bitmap.
 *
 * @param values one float in [0,1] per pixel, row-major
 */
export function updateBodyMask(mask: BodyMask, values: Float32Array): boolean {
  const ctx = mask.canvas.getContext('2d', { willReadFrequently: true });
  if (ctx == null) return false;

  const pixels = mask.width * mask.height;
  if (values.length < pixels) return false;

  const image = ctx.createImageData(mask.width, mask.height);
  const data = image.data;
  for (let i = 0; i < pixels; i++) {
    const v = values[i]!;
    // White everywhere, with confidence carried entirely in the alpha, so the
    // bitmap can be used directly as a destination-in stencil.
    data[i * 4] = 255;
    data[i * 4 + 1] = 255;
    data[i * 4 + 2] = 255;
    data[i * 4 + 3] = v < THRESHOLD ? 0 : Math.round(Math.min(1, v) * 255);
  }
  ctx.putImageData(image, 0, 0);
  return true;
}

/**
 * Clips whatever has been drawn on `ctx` to the body silhouette.
 *
 * The mask covers the same field of view as the video, so it is drawn with the
 * preview's own cover transform - anything else and the garment would be
 * clipped against a silhouette that sits slightly off the wearer.
 */
export function clipToBody(
  ctx: CanvasRenderingContext2D,
  mask: BodyMask,
  placement: { x: number; y: number; width: number; height: number; mirrored: boolean },
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  if (FEATHER_PX > 0) ctx.filter = `blur(${FEATHER_PX}px)`;
  if (placement.mirrored) {
    ctx.translate(placement.x * 2 + placement.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(mask.canvas, placement.x, placement.y, placement.width, placement.height);
  ctx.restore();
}
