import React from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Path, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import { KP, MIN_KEYPOINT_SCORE, type Pose } from '../pose/keypoints';
import { colors } from '../theme';

interface Props {
  pose: SharedValue<Pose>;
  width: number;
  height: number;
}

/** Bones drawn between landmark pairs, enough to read posture at a glance. */
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
 * Developer overlay: draws the raw skeleton in VIEW space.
 *
 * This is the fastest way to confirm the projection in `pose/projection.ts` is
 * right on a given device. If the skeleton tracks your body, the garment will
 * too; if it is rotated or mirrored, the rotation table in that module is what
 * needs adjusting - not the fitting maths.
 */
export function PoseDebugOverlay({ pose, width, height }: Props) {
  const skeleton = useDerivedValue(() => {
    const path = Skia.Path.Make();
    const p = pose.value;

    for (let i = 0; i < BONES.length; i++) {
      const bone = BONES[i];
      if (bone == null) continue;
      const a = p[bone[0]];
      const b = p[bone[1]];
      if (a == null || b == null) continue;
      if (a.score < MIN_KEYPOINT_SCORE || b.score < MIN_KEYPOINT_SCORE) continue;
      path.moveTo(a.x, a.y);
      path.lineTo(b.x, b.y);
    }

    for (let i = 0; i < p.length; i++) {
      const kp = p[i];
      if (kp == null || kp.score < MIN_KEYPOINT_SCORE) continue;
      path.addCircle(kp.x, kp.y, 5);
    }

    return path;
  }, [pose]);

  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Path
        path={skeleton}
        color={colors.accent}
        style="stroke"
        strokeWidth={3}
        strokeCap="round"
      />
    </Canvas>
  );
}
