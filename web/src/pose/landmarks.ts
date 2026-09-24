/**
 * Adapts MediaPipe Pose Landmarker output to the app's keypoint layout.
 *
 * MediaPipe emits 33 landmarks; the fitting maths is written against MoveNet's
 * 17, which the React Native app uses. Mapping here rather than reworking the
 * maths keeps one shared `solveFit` serving both platforms.
 *
 * MediaPipe gives a `visibility` in [0,1] per landmark, which stands in for
 * MoveNet's confidence score - both mean "how sure am I this joint is here".
 */
import { KP, KEYPOINT_COUNT, type Pose } from '@shared/pose/keypoints';

/** MediaPipe BlazePose landmark indices, for the joints the app needs. */
const MEDIAPIPE_INDEX: Record<KP, number | null> = {
  [KP.Nose]: 0,
  [KP.LeftEye]: 2,
  [KP.RightEye]: 5,
  [KP.LeftEar]: 7,
  [KP.RightEar]: 8,
  [KP.LeftShoulder]: 11,
  [KP.RightShoulder]: 12,
  [KP.LeftElbow]: 13,
  [KP.RightElbow]: 14,
  [KP.LeftWrist]: 15,
  [KP.RightWrist]: 16,
  [KP.LeftHip]: 23,
  [KP.RightHip]: 24,
  [KP.LeftKnee]: 25,
  [KP.RightKnee]: 26,
  [KP.LeftAnkle]: 27,
  [KP.RightAnkle]: 28,
};

export interface NormalizedLandmark {
  x: number;
  y: number;
  visibility?: number;
}

/**
 * Converts one MediaPipe result into a pose in normalised [0,1] video space.
 * Projection into view coordinates happens separately, in `project.ts`.
 */
export function toPose(landmarks: readonly NormalizedLandmark[]): Pose {
  const pose: Pose = [];
  for (let i = 0; i < KEYPOINT_COUNT; i++) {
    const source = MEDIAPIPE_INDEX[i as KP];
    const landmark = source == null ? undefined : landmarks[source];
    if (landmark == null) {
      pose.push({ x: 0, y: 0, score: 0 });
      continue;
    }
    pose.push({
      x: landmark.x,
      y: landmark.y,
      // MediaPipe omits visibility on some builds; treat that as "seen".
      score: landmark.visibility ?? 1,
    });
  }
  return pose;
}
