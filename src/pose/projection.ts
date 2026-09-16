/**
 * Maps MoveNet output back onto the preview the user is actually looking at.
 *
 * There are four coordinate spaces in play and getting any one of them wrong
 * puts the garment somewhere plausible-but-wrong, so they are named here:
 *
 *  1. BUFFER   - the raw camera frame as delivered, `frame.width x frame.height`.
 *                On most phones in portrait this buffer is landscape and
 *                `frame.orientation` says how it is rotated.
 *  2. SQUARE   - the centred square we crop out of BUFFER and hand to the model.
 *                Model output is normalised [0,1] against *this*, not the frame.
 *  3. UPRIGHT  - BUFFER rotated so the subject is head-up.
 *  4. VIEW     - density-independent points inside the <Camera> element, which
 *                renders UPRIGHT with `resizeMode="cover"`.
 *
 * Convention: `rotationForOrientation` returns the degrees BUFFER must be
 * rotated CLOCKWISE to become UPRIGHT.
 */
import type { Vec2 } from '../utils/math';

export type FrameOrientation =
  | 'portrait'
  | 'portrait-upside-down'
  | 'landscape-left'
  | 'landscape-right';

export interface ViewSize {
  width: number;
  height: number;
}

export interface ProjectionConfig {
  /** BUFFER dimensions, straight off the frame. */
  frameWidth: number;
  frameHeight: number;
  orientation: FrameOrientation;
  /** Size of the on-screen preview in points. */
  view: ViewSize;
  /** Front camera previews are mirrored, so the overlay must be too. */
  mirrored: boolean;
}

export function rotationForOrientation(orientation: FrameOrientation): number {
  'worklet';
  switch (orientation) {
    case 'portrait':
      return 0;
    case 'landscape-left':
      return 90;
    case 'portrait-upside-down':
      return 180;
    case 'landscape-right':
      return 270;
    default:
      return 0;
  }
}

/**
 * The centred square cropped out of BUFFER and fed to the model.
 * A centred square is rotation-invariant, so the same rect is valid whether
 * you think of it in BUFFER or UPRIGHT space — which is what lets us rotate
 * the normalised model output before un-normalising it.
 */
export function squareCrop(
  frameWidth: number,
  frameHeight: number,
): { x: number; y: number; size: number } {
  'worklet';
  const size = Math.min(frameWidth, frameHeight);
  return {
    x: Math.round((frameWidth - size) / 2),
    y: Math.round((frameHeight - size) / 2),
    size,
  };
}

/** Rotates a normalised point inside the unit square, clockwise. */
function rotateUnit(x: number, y: number, degrees: number): Vec2 {
  'worklet';
  switch (degrees) {
    case 90:
      return { x: 1 - y, y: x };
    case 180:
      return { x: 1 - x, y: 1 - y };
    case 270:
      return { x: y, y: 1 - x };
    default:
      return { x, y };
  }
}

/**
 * Normalised model output -> VIEW points.
 *
 * @param nx normalised x in SQUARE, [0,1]
 * @param ny normalised y in SQUARE, [0,1]
 */
export function projectToView(nx: number, ny: number, config: ProjectionConfig): Vec2 {
  'worklet';
  const rotation = rotationForOrientation(config.orientation);
  const rotated = rotateUnit(nx, ny, rotation);

  const swapped = rotation === 90 || rotation === 270;
  const uprightW = swapped ? config.frameHeight : config.frameWidth;
  const uprightH = swapped ? config.frameWidth : config.frameHeight;

  // SQUARE -> UPRIGHT pixels. The crop is centred, so its origin in UPRIGHT
  // space is half the leftover on each axis.
  const size = Math.min(uprightW, uprightH);
  const upX = (uprightW - size) / 2 + rotated.x * size;
  const upY = (uprightH - size) / 2 + rotated.y * size;

  // UPRIGHT -> VIEW, matching resizeMode="cover": scale by the larger ratio
  // and centre the overflow.
  const scale = Math.max(config.view.width / uprightW, config.view.height / uprightH);
  let viewX = upX * scale + (config.view.width - uprightW * scale) / 2;
  const viewY = upY * scale + (config.view.height - uprightH * scale) / 2;

  if (config.mirrored) {
    viewX = config.view.width - viewX;
  }

  return { x: viewX, y: viewY };
}
