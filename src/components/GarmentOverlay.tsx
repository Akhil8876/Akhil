import React from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Group, Image, useImage } from '@shopify/react-native-skia';
import { useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { Garment } from '../catalog/types';
import type { Pose } from '../pose/keypoints';
import { solveFit } from '../fit/solveFit';

interface Props {
  pose: SharedValue<Pose>;
  garment: Garment;
  /** Manual trim from the fit sheet. */
  fitTrim: number;
  width: number;
  height: number;
}

/**
 * Draws the garment over the camera preview.
 *
 * The whole path from landmark to pixel runs on the UI thread: `pose` is
 * written by the frame processor, and these derived values recompute in a
 * worklet whenever it changes. Nothing here round-trips through React, which
 * is what keeps the garment locked to the body instead of trailing it.
 */
export function GarmentOverlay({ pose, garment, fitTrim, width, height }: Props) {
  const image = useImage(garment.image);

  const { anchors, shoulderEase, lengthEase } = garment;

  // Solved once per pose update; the render values below are cheap reads of it.
  const fit = useDerivedValue(
    () =>
      solveFit(pose.value, anchors, {
        shoulderEase,
        lengthEase,
        userScale: fitTrim,
      }),
    [pose, anchors, shoulderEase, lengthEase, fitTrim],
  );

  const transform = useDerivedValue(() => {
    const f = fit.value;
    if (f == null) {
      // Park the artwork off-screen rather than unmounting it: opacity is
      // already 0, and keeping the node mounted avoids a texture re-upload
      // every time tracking blinks.
      return [{ translateX: -10000 }, { translateY: -10000 }];
    }
    return [
      { translateX: f.originX },
      { translateY: f.originY },
      { rotate: f.rotation },
      { scaleX: f.scaleX },
      { scaleY: f.scaleY },
      { translateX: -f.anchorX },
      { translateY: -f.anchorY },
    ];
  }, [fit]);

  const opacity = useDerivedValue(() => fit.value?.confidence ?? 0, [fit]);

  if (image == null) return null;

  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]} pointerEvents="none">
      <Group transform={transform} opacity={opacity}>
        <Image
          image={image}
          x={0}
          y={0}
          width={anchors.width}
          height={anchors.height}
          fit="fill"
        />
      </Group>
    </Canvas>
  );
}
