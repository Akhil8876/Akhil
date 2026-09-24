/**
 * How a torso narrows from the shoulders to the hips.
 *
 * This is what lets a garment be warped onto a body instead of pasted over it.
 * It deliberately comes from the four torso landmarks rather than from the
 * segmentation mask: the mask's outline at chest height is the torso *plus*
 * both arms, so warping to it makes a t-shirt widen until the sleeves swallow
 * the forearms. Landmarks describe the torso alone.
 *
 * Pure and platform-neutral, so the React Native renderer can use it too.
 */
import { KP, type Pose } from '../pose/keypoints';
import { distance, midpoint } from '../utils/math';

export interface TorsoTaper {
  /** Half the shoulder breadth, in whatever units the pose is in. */
  shoulderHalf: number;
  /** Half the hip breadth, same units. */
  hipHalf: number;
  /** Shoulder line to hip line along the torso axis. */
  torsoLength: number;
}

/**
 * Bounds on the shoulder-to-hip ratio. A mis-detected hip can otherwise report
 * a waist near zero or wider than the shoulders, and the garment would follow.
 */
const MIN_RATIO = 0.6;
const MAX_RATIO = 1.25;

export function torsoTaperFromPose(pose: Pose): TorsoTaper | null {
  const ls = pose[KP.LeftShoulder];
  const rs = pose[KP.RightShoulder];
  const lh = pose[KP.LeftHip];
  const rh = pose[KP.RightHip];
  if (!ls || !rs || !lh || !rh) return null;

  const shoulderHalf = distance(ls, rs) / 2;
  const hipHalf = distance(lh, rh) / 2;
  const torsoLength = distance(midpoint(ls, rs), midpoint(lh, rh));
  if (shoulderHalf <= 0 || torsoLength <= 0) return null;

  return { shoulderHalf, hipHalf, torsoLength };
}

/**
 * Width at a distance down the torso, as a multiple of shoulder width.
 *
 * 1 at the shoulder line, the hip ratio at the hip line, and held constant
 * below that - a hem hangs straight rather than continuing to taper toward a
 * point.
 */
export function taperAt(taper: TorsoTaper, along: number): number {
  const ratio = Math.max(
    MIN_RATIO,
    Math.min(MAX_RATIO, taper.hipHalf / taper.shoulderHalf),
  );
  const t = Math.max(0, Math.min(1, along / taper.torsoLength));
  return 1 + (ratio - 1) * t;
}
