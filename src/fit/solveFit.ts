/**
 * Turns four torso landmarks into an affine placement for a garment.
 *
 * The garment is anchored at the shoulder midpoint, rotated to the shoulder
 * line, scaled across by shoulder breadth and down by torso length. Scaling
 * the two axes independently is deliberate: it lets one artwork fit both a
 * long torso and a short one without looking stretched sideways, because the
 * rotation has already aligned the artwork's axes with the body's.
 */
import { KP, MIN_KEYPOINT_SCORE, type Pose } from '../pose/keypoints';
import type { GarmentAnchors } from '../catalog/types';
import { clamp, distance, midpoint } from '../utils/math';

export interface GarmentTransform {
  /** VIEW-space point the artwork's shoulder anchor is pinned to. */
  originX: number;
  originY: number;
  /** Radians, clockwise-positive, 0 when the shoulder line is level. */
  rotation: number;
  scaleX: number;
  scaleY: number;
  /** Artwork-space anchor, echoed so the renderer can offset before scaling. */
  anchorX: number;
  anchorY: number;
  /** 0..1 confidence used to fade the overlay in and out. */
  confidence: number;
}

export interface FitOptions {
  shoulderEase: number;
  lengthEase: number;
  /** User trim from the size sheet, multiplies both axes. 1.0 = as-cut. */
  userScale?: number;
}

/**
 * A torso seen from a sharp angle projects to a narrow shoulder line, which
 * would scale the garment down to a sliver. Below this ratio of shoulder
 * breadth to torso length we treat the pose as too oblique to dress.
 */
const MIN_ASPECT = 0.22;

export function solveFit(
  pose: Pose,
  anchors: GarmentAnchors,
  options: FitOptions,
): GarmentTransform | null {
  'worklet';
  const ls = pose[KP.LeftShoulder];
  const rs = pose[KP.RightShoulder];
  const lh = pose[KP.LeftHip];
  const rh = pose[KP.RightHip];
  if (!ls || !rs || !lh || !rh) return null;

  const shoulderMid = midpoint(ls, rs);
  const hipMid = midpoint(lh, rh);

  const shoulderWidth = distance(ls, rs);
  const torsoLength = distance(shoulderMid, hipMid);
  if (shoulderWidth < 1 || torsoLength < 1) return null;
  if (shoulderWidth / torsoLength < MIN_ASPECT) return null;

  let rotation = Math.atan2(rs.y - ls.y, rs.x - ls.x);

  // MoveNet labels shoulders anatomically: "left" is the wearer's own left,
  // which lands on the RIGHT of an unmirrored frame. Right-minus-left
  // therefore flips sign with the mirroring, and on an unmirrored frame the
  // garment would hang upside down (measured: 173 degrees instead of 7).
  //
  // Rather than trust the labelling, settle it against the body: the artwork's
  // +y axis runs shoulders-to-hem, so it has to point at the hips.
  const downX = -Math.sin(rotation);
  const downY = Math.cos(rotation);
  if (downX * (hipMid.x - shoulderMid.x) + downY * (hipMid.y - shoulderMid.y) < 0) {
    rotation += Math.PI;
  }

  // Keep the angle in (-pi, pi] so callers and tests see a canonical value.
  if (rotation > Math.PI) rotation -= 2 * Math.PI;
  else if (rotation <= -Math.PI) rotation += 2 * Math.PI;

  const userScale = options.userScale ?? 1;
  const scaleX = ((shoulderWidth * options.shoulderEase) / anchors.shoulderWidth) * userScale;
  const scaleY = ((torsoLength * options.lengthEase) / anchors.torsoLength) * userScale;

  // Confidence is driven by the weakest landmark: one lost hip should fade the
  // garment, not snap it away.
  const weakest = Math.min(ls.score, rs.score, lh.score, rh.score);
  const confidence = clamp((weakest - MIN_KEYPOINT_SCORE * 0.7) / 0.3, 0, 1);

  return {
    originX: shoulderMid.x,
    originY: shoulderMid.y,
    rotation,
    scaleX,
    scaleY,
    anchorX: anchors.shoulderMid.x,
    anchorY: anchors.shoulderMid.y,
    confidence,
  };
}
