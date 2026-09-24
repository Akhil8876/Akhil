/**
 * Canvas 2D rendering of the garment and the debug skeleton.
 *
 * The transform chain is the same one the React Native app applies through
 * Skia - anchor at the shoulder midpoint, rotate to the shoulder line, scale
 * across by breadth and down by torso length. Canvas rotates clockwise on a
 * y-down surface exactly as Skia does, so `solveFit` output drops straight in.
 */
import { solveFit } from '@shared/fit/solveFit';
import { KP, MIN_KEYPOINT_SCORE, type Pose } from '@shared/pose/keypoints';
import type { GarmentAnchors } from '@shared/catalog/types';

export interface DrawGarmentOptions {
  pose: Pose;
  image: CanvasImageSource;
  anchors: GarmentAnchors;
  shoulderEase: number;
  lengthEase: number;
  fitTrim: number;
  /** Scales view coordinates into the target surface, 1 for the live preview. */
  scale?: number;
}

/** Returns true when a garment was actually drawn. */
export function drawGarment(
  ctx: CanvasRenderingContext2D,
  options: DrawGarmentOptions,
): boolean {
  const fit = solveFit(options.pose, options.anchors, {
    shoulderEase: options.shoulderEase,
    lengthEase: options.lengthEase,
    userScale: options.fitTrim,
  });
  if (fit == null) return false;

  const scale = options.scale ?? 1;

  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(1, fit.confidence));
  ctx.scale(scale, scale);
  ctx.translate(fit.originX, fit.originY);
  ctx.rotate(fit.rotation);
  ctx.scale(fit.scaleX, fit.scaleY);
  ctx.translate(-fit.anchorX, -fit.anchorY);
  ctx.drawImage(options.image, 0, 0, options.anchors.width, options.anchors.height);
  ctx.restore();

  return true;
}

const BONES: [KP, KP][] = [
  [KP.LeftShoulder, KP.RightShoulder],
  [KP.LeftShoulder, KP.LeftElbow],
  [KP.LeftElbow, KP.LeftWrist],
  [KP.RightShoulder, KP.RightElbow],
  [KP.RightElbow, KP.RightWrist],
  [KP.LeftShoulder, KP.LeftHip],
  [KP.RightShoulder, KP.RightHip],
  [KP.LeftHip, KP.RightHip],
  [KP.LeftHip, KP.LeftKnee],
  [KP.LeftKnee, KP.LeftAnkle],
  [KP.RightHip, KP.RightKnee],
  [KP.RightKnee, KP.RightAnkle],
];

/**
 * Draws the raw landmarks. The fastest way to tell a tracking problem from a
 * fitting problem: if the skeleton follows the wearer, the garment will too.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  color = '#E8D5B7',
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  ctx.beginPath();
  for (const [from, to] of BONES) {
    const a = pose[from];
    const b = pose[to];
    if (a == null || b == null) continue;
    if (a.score < MIN_KEYPOINT_SCORE || b.score < MIN_KEYPOINT_SCORE) continue;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  for (const kp of pose) {
    if (kp.score < MIN_KEYPOINT_SCORE) continue;
    ctx.beginPath();
    ctx.arc(kp.x, kp.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
