/**
 * Geometry for compositing a saved look.
 *
 * A snapshot has to reproduce what the wearer saw on screen: the preview
 * cover-crops the camera frame into the view, so the still has to be cropped
 * the same way before the garment is drawn back on at view coordinates.
 *
 * Kept free of Skia and React Native imports so it can be tested directly.
 */
import { rotationForOrientation, type FrameOrientation, type ViewSize } from '../pose/projection';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UprightSize {
  width: number;
  height: number;
  /** Degrees the photo buffer must be rotated clockwise to appear upright. */
  rotation: number;
}

/**
 * Dimensions of the photo once its orientation has been applied.
 *
 * Same convention as `pose/projection.ts`: a quarter-turn swaps the axes.
 */
export function uprightPhotoSize(
  width: number,
  height: number,
  orientation: FrameOrientation,
): UprightSize {
  const rotation = rotationForOrientation(orientation);
  const swapped = rotation === 90 || rotation === 270;
  return {
    width: swapped ? height : width,
    height: swapped ? width : height,
    rotation,
  };
}

/**
 * The centred sub-rect of the source that fills a destination of the given
 * aspect ratio - the crop `resizeMode="cover"` performs.
 */
export function coverSourceRect(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number,
): Rect {
  if (srcWidth <= 0 || srcHeight <= 0 || dstWidth <= 0 || dstHeight <= 0) {
    return { x: 0, y: 0, width: Math.max(srcWidth, 0), height: Math.max(srcHeight, 0) };
  }

  const dstAspect = dstWidth / dstHeight;
  const srcAspect = srcWidth / srcHeight;

  if (srcAspect > dstAspect) {
    // Source is wider than the destination: trim the sides.
    const width = srcHeight * dstAspect;
    return { x: (srcWidth - width) / 2, y: 0, width, height: srcHeight };
  }

  // Source is taller: trim top and bottom.
  const height = srcWidth / dstAspect;
  return { x: 0, y: (srcHeight - height) / 2, width: srcWidth, height };
}

export interface OutputSize {
  width: number;
  height: number;
  /** Multiplier from VIEW points to output pixels. */
  scale: number;
}

/**
 * Output canvas size for a snapshot.
 *
 * The canvas keeps the preview's aspect ratio - what you saw is what you get -
 * and is sized to the photo's own resolution so the still is sharper than the
 * on-screen preview, capped so a 48MP sensor does not allocate a surface the
 * GPU will refuse.
 */
export function computeOutputSize(
  view: ViewSize,
  uprightPhotoWidth: number,
  maxWidth: number,
): OutputSize {
  if (view.width <= 0 || view.height <= 0) {
    return { width: 0, height: 0, scale: 0 };
  }

  // Never downscale below the preview; never exceed the cap.
  const targetWidth = Math.min(Math.max(uprightPhotoWidth, view.width), maxWidth);
  const width = Math.round(targetWidth);
  const height = Math.round(width * (view.height / view.width));

  return { width, height, scale: width / view.width };
}

/**
 * A canvas transform step.
 *
 * The compositor's transform chains are expressed as data rather than as
 * direct Skia calls so they can be exercised without a GPU - see
 * `tests/capture.test.ts`, which replays them through a plain matrix.
 */
export type CanvasOp =
  | { op: 'translate'; x: number; y: number }
  | { op: 'scale'; x: number; y: number }
  | { op: 'rotate'; degrees: number };

export interface PhotoTransformParams {
  photoWidth: number;
  photoHeight: number;
  orientation: FrameOrientation;
  /** True when the still must be flipped to match a mirrored preview. */
  mirror: boolean;
  output: { width: number; height: number };
}

/**
 * Transform placing the photo buffer into the output so that it reproduces the
 * preview: oriented upright, mirrored to match, and cover-cropped.
 *
 * Applied in order, these leave the canvas in photo-buffer coordinates, so the
 * image can then be drawn at its natural size.
 */
export function photoTransform(params: PhotoTransformParams): CanvasOp[] {
  const { photoWidth, photoHeight, orientation, mirror, output } = params;
  const upright = uprightPhotoSize(photoWidth, photoHeight, orientation);
  const crop = coverSourceRect(upright.width, upright.height, output.width, output.height);

  const ops: CanvasOp[] = [];

  // 1. Cropped region of the upright photo -> the whole output. The crop
  //    already matches the output aspect, so this scale is uniform.
  const scale = crop.width > 0 ? output.width / crop.width : 1;
  ops.push({ op: 'scale', x: scale, y: scale });
  ops.push({ op: 'translate', x: -crop.x, y: -crop.y });
  // Canvas units are now upright-photo pixels.

  // 2. Match the preview's mirroring, reflecting about the upright centre.
  if (mirror) {
    ops.push({ op: 'translate', x: upright.width / 2, y: 0 });
    ops.push({ op: 'scale', x: -1, y: 1 });
    ops.push({ op: 'translate', x: -upright.width / 2, y: 0 });
  }

  // 3. Rotate the buffer into upright space about the shared centre.
  ops.push({ op: 'translate', x: upright.width / 2, y: upright.height / 2 });
  ops.push({ op: 'rotate', degrees: upright.rotation });
  ops.push({ op: 'translate', x: -photoWidth / 2, y: -photoHeight / 2 });

  return ops;
}

/**
 * Transform placing the garment into the output.
 *
 * Scaling into VIEW units first means the remaining steps are the identical
 * sequence the live overlay uses, so a still cannot drift from the preview.
 */
export function garmentTransform(
  fit: {
    originX: number;
    originY: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
    anchorX: number;
    anchorY: number;
  },
  viewToOutputScale: number,
): CanvasOp[] {
  return [
    { op: 'scale', x: viewToOutputScale, y: viewToOutputScale },
    { op: 'translate', x: fit.originX, y: fit.originY },
    { op: 'rotate', degrees: (fit.rotation * 180) / Math.PI },
    { op: 'scale', x: fit.scaleX, y: fit.scaleY },
    { op: 'translate', x: -fit.anchorX, y: -fit.anchorY },
  ];
}

/**
 * Reconciles what the camera said about a still with what the decoder produced.
 *
 * Some JPEG decoders apply the EXIF orientation tag while decoding, handing
 * back an image that is already upright. Rotating that again would turn the
 * snapshot on its side. The declared dimensions give it away: if they come back
 * transposed, the decoder has already done the work.
 *
 * @param declaredWidth  `PhotoFile.width`, as reported by the camera
 * @param decodedWidth   `SkImage.width()`, after decoding
 */
export function resolvePhotoOrientation(
  declaredWidth: number,
  declaredHeight: number,
  decodedWidth: number,
  decodedHeight: number,
  declared: FrameOrientation,
): FrameOrientation {
  const rotation = rotationForOrientation(declared);
  if (rotation !== 90 && rotation !== 270) {
    // A half turn does not change the aspect, so there is nothing to detect.
    return declared;
  }

  if (decodedWidth === decodedHeight) {
    // A square image is transposed either way, so it reveals nothing. Trust
    // what the camera reported rather than guessing.
    return declared;
  }

  const transposed = decodedWidth === declaredHeight && decodedHeight === declaredWidth;
  return transposed ? 'portrait' : declared;
}
