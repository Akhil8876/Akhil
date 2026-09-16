/**
 * Estimates real-world body measurements from a pose, so the app can
 * recommend a size instead of making the wearer guess.
 *
 * A single camera cannot recover absolute scale on its own, so everything
 * here is pinned to one number the user supplies: their height. Given that,
 * pixels convert to centimetres and the rest follows.
 */
import { KP, MIN_KEYPOINT_SCORE, type Pose } from '../pose/keypoints';
import type { SizeChartEntry } from '../catalog/types';
import { distance, midpoint } from '../utils/math';

export type MeasurementQuality = 'full-body' | 'estimated' | 'unavailable';

export interface BodyMeasurements {
  shoulderCm: number;
  /** Derived, not observed - see `CHEST_FROM_SHOULDER`. */
  chestCm: number;
  quality: MeasurementQuality;
}

/**
 * Biacromial breadth is a fairly stable fraction of stature across adult
 * populations (~0.23-0.26). Used only when the legs are out of frame and we
 * cannot measure a pixel height directly.
 */
const SHOULDER_TO_HEIGHT = 0.245;

/**
 * Chest circumference from shoulder breadth. A torso is closer to an ellipse
 * than a circle, so this is well short of pi. Calibrated against menswear and
 * womenswear size charts; treat the output as a starting point, not a tailor.
 */
const CHEST_FROM_SHOULDER = 2.32;

/**
 * MoveNet gives us ankles, not heels, and no head crown. Standing height is
 * therefore a little more than ankle-to-nose; this scales it back up.
 */
const NOSE_TO_ANKLE_FRACTION = 0.87;

export function measureBody(pose: Pose, userHeightCm: number): BodyMeasurements {
  const ls = pose[KP.LeftShoulder];
  const rs = pose[KP.RightShoulder];
  if (!ls || !rs || ls.score < MIN_KEYPOINT_SCORE || rs.score < MIN_KEYPOINT_SCORE) {
    return { shoulderCm: 0, chestCm: 0, quality: 'unavailable' };
  }

  const shoulderPx = distance(ls, rs);
  const nose = pose[KP.Nose];
  const la = pose[KP.LeftAnkle];
  const ra = pose[KP.RightAnkle];

  const fullBody =
    !!nose &&
    !!la &&
    !!ra &&
    nose.score >= MIN_KEYPOINT_SCORE &&
    la.score >= MIN_KEYPOINT_SCORE &&
    ra.score >= MIN_KEYPOINT_SCORE;

  if (fullBody) {
    // Measure the wearer's own pixel height this frame, so the estimate holds
    // whether they are near the phone or across the room.
    const ankleMid = midpoint(la, ra);
    const visiblePx = distance(nose, ankleMid);
    if (visiblePx > 1) {
      const bodyPx = visiblePx / NOSE_TO_ANKLE_FRACTION;
      const cmPerPx = userHeightCm / bodyPx;
      const shoulderCm = shoulderPx * cmPerPx;
      return {
        shoulderCm,
        chestCm: shoulderCm * CHEST_FROM_SHOULDER,
        quality: 'full-body',
      };
    }
  }

  // Half-body framing: fall back to the population ratio. Less accurate, and
  // the UI says so rather than quietly presenting it as a measurement.
  const shoulderCm = userHeightCm * SHOULDER_TO_HEIGHT;
  return {
    shoulderCm,
    chestCm: shoulderCm * CHEST_FROM_SHOULDER,
    quality: 'estimated',
  };
}

export interface SizeRecommendation {
  size: SizeChartEntry;
  /** 'in-range' when the body falls inside the size's band. */
  match: 'in-range' | 'closest';
  note: string;
}

export function recommendSize(
  measurements: BodyMeasurements,
  sizes: SizeChartEntry[],
): SizeRecommendation | null {
  if (measurements.quality === 'unavailable' || sizes.length === 0) return null;

  for (const size of sizes) {
    const [min, max] = size.shoulderCm;
    if (measurements.shoulderCm >= min && measurements.shoulderCm <= max) {
      return {
        size,
        match: 'in-range',
        note:
          measurements.quality === 'full-body'
            ? 'Measured from your full-body pose.'
            : 'Estimated from your height - step back to include your feet for a measured fit.',
      };
    }
  }

  // Outside every band: offer the nearest rather than nothing, and say so.
  let closest = sizes[0]!;
  let bestDelta = Infinity;
  for (const size of sizes) {
    const [min, max] = size.shoulderCm;
    const center = (min + max) / 2;
    const delta = Math.abs(measurements.shoulderCm - center);
    if (delta < bestDelta) {
      bestDelta = delta;
      closest = size;
    }
  }

  const tooBig = measurements.shoulderCm > closest.shoulderCm[1];
  return {
    size: closest,
    match: 'closest',
    note: tooBig
      ? "You measure above this brand's largest size - expect a snug fit."
      : "You measure below this brand's smallest size - expect a loose fit.",
  };
}
