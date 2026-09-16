import { useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useFrameProcessor, runAtTargetFps, type Frame } from 'react-native-vision-camera';
import { useResizePlugin } from 'vision-camera-resize-plugin';
import { useTensorflowModel } from 'react-native-fast-tflite';

import { KEYPOINT_COUNT, emptyPose, type Pose } from './keypoints';
import {
  projectToView,
  squareCrop,
  type FrameOrientation,
  type ViewSize,
} from './projection';
import {
  createOneEuroState,
  filterOneEuro,
  type OneEuroState,
} from '../utils/oneEuro';

/** MoveNet SinglePose Lightning expects a 192x192 uint8 RGB square. */
const MODEL_INPUT_SIZE = 192;

/**
 * Pose inference is capped below the preview framerate on purpose. The preview
 * stays at 60fps so the camera feels live, while inference at 30fps halves the
 * thermal load - and the One Euro filter hides the difference.
 */
const INFERENCE_FPS = 30;

export type DetectorStatus = 'loading' | 'ready' | 'error';

export interface PoseDetector {
  status: DetectorStatus;
  error: Error | undefined;
  /** Latest smoothed pose in VIEW coordinates. Read from UI-thread worklets. */
  pose: SharedValue<Pose>;
  frameProcessor: ReturnType<typeof useFrameProcessor>;
}

export interface PoseDetectorOptions {
  view: ViewSize;
  /** True for the front camera, whose preview is mirrored. */
  mirrored: boolean;
}

export function usePoseDetector({ view, mirrored }: PoseDetectorOptions): PoseDetector {
  const model = useTensorflowModel(require('../../assets/models/movenet-lightning.tflite'));
  const { resize } = useResizePlugin();

  const pose = useSharedValue<Pose>(emptyPose());

  // One filter per axis per keypoint. Kept in a shared value so the state
  // survives between frames on the frame-processor runtime.
  const filters = useSharedValue<OneEuroState[]>(
    Array.from({ length: KEYPOINT_COUNT * 2 }, () => createOneEuroState()),
  );

  const loadedModel = model.state === 'loaded' ? model.model : undefined;

  const frameProcessor = useFrameProcessor(
    (frame: Frame) => {
      'worklet';
      if (loadedModel == null) return;
      if (view.width <= 0 || view.height <= 0) return;

      runAtTargetFps(INFERENCE_FPS, () => {
        'worklet';
        const crop = squareCrop(frame.width, frame.height);
        const input = resize(frame, {
          scale: { width: MODEL_INPUT_SIZE, height: MODEL_INPUT_SIZE },
          crop: { x: crop.x, y: crop.y, width: crop.size, height: crop.size },
          pixelFormat: 'rgb',
          dataType: 'uint8',
        });

        const outputs = loadedModel.runSync([input]);
        const raw = outputs[0];
        if (raw == null) return;

        const config = {
          frameWidth: frame.width,
          frameHeight: frame.height,
          orientation: frame.orientation as FrameOrientation,
          view,
          mirrored,
        };

        // `frame.timestamp` is nanoseconds since boot on both platforms.
        const timestampMs = frame.timestamp / 1e6;

        const states = filters.value;
        const next: Pose = [];
        for (let i = 0; i < KEYPOINT_COUNT; i++) {
          // MoveNet packs each keypoint as (y, x, score), y first.
          const ny = Number(raw[i * 3]);
          const nx = Number(raw[i * 3 + 1]);
          const score = Number(raw[i * 3 + 2]);

          const projected = projectToView(nx, ny, config);

          const xState = states[i * 2];
          const yState = states[i * 2 + 1];
          if (xState == null || yState == null) continue;

          next.push({
            x: filterOneEuro(xState, projected.x, timestampMs),
            y: filterOneEuro(yState, projected.y, timestampMs),
            score,
          });
        }

        // Reassign rather than mutate: shared values only propagate across
        // worklet runtimes on assignment.
        filters.value = states;
        pose.value = next;
      });
    },
    [loadedModel, resize, view.width, view.height, mirrored],
  );

  const status: DetectorStatus =
    model.state === 'loaded' ? 'ready' : model.state === 'error' ? 'error' : 'loading';

  return {
    status,
    error: model.state === 'error' ? model.error : undefined,
    pose,
    frameProcessor,
  };
}
