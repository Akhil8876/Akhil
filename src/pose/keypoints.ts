/**
 * MoveNet SinglePose keypoint layout.
 *
 * The model emits a [1, 1, 17, 3] tensor where each keypoint is
 * (y, x, score) normalised to [0, 1] against the *model input square*,
 * not against the camera frame. See `projection.ts` for the mapping back.
 */
export const KEYPOINT_COUNT = 17;

export enum KP {
  Nose = 0,
  LeftEye = 1,
  RightEye = 2,
  LeftEar = 3,
  RightEar = 4,
  LeftShoulder = 5,
  RightShoulder = 6,
  LeftElbow = 7,
  RightElbow = 8,
  LeftWrist = 9,
  RightWrist = 10,
  LeftHip = 11,
  RightHip = 12,
  LeftKnee = 13,
  RightKnee = 14,
  LeftAnkle = 15,
  RightAnkle = 16,
}

export interface Keypoint {
  /** View-space x in density-independent pixels. */
  x: number;
  /** View-space y in density-independent pixels. */
  y: number;
  /** Model confidence in [0, 1]. */
  score: number;
}

export type Pose = Keypoint[];

/** Keypoints below this score are treated as "not seen this frame". */
export const MIN_KEYPOINT_SCORE = 0.3;

/** The four landmarks a torso garment is anchored to. */
export const TORSO_KEYPOINTS = [
  KP.LeftShoulder,
  KP.RightShoulder,
  KP.LeftHip,
  KP.RightHip,
] as const;

export function emptyPose(): Pose {
  'worklet';
  return new Array(KEYPOINT_COUNT).fill(null).map(() => ({ x: 0, y: 0, score: 0 }));
}

/**
 * True when every landmark a torso garment needs was seen confidently.
 * Hips are allowed to be weaker than shoulders: they are frequently
 * occluded by a table or a counter in a half-body framing.
 */
export function hasTorso(pose: Pose): boolean {
  'worklet';
  const ls = pose[KP.LeftShoulder];
  const rs = pose[KP.RightShoulder];
  const lh = pose[KP.LeftHip];
  const rh = pose[KP.RightHip];
  if (!ls || !rs || !lh || !rh) return false;
  return (
    ls.score >= MIN_KEYPOINT_SCORE &&
    rs.score >= MIN_KEYPOINT_SCORE &&
    lh.score >= MIN_KEYPOINT_SCORE * 0.7 &&
    rh.score >= MIN_KEYPOINT_SCORE * 0.7
  );
}
