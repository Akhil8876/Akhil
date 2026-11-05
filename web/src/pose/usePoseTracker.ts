import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

import { emptyPose, KEYPOINT_COUNT, type Pose } from '@shared/pose/keypoints';
import { createOneEuroState, filterOneEuro, type OneEuroState } from '@shared/utils/oneEuro';
import { toPose } from './landmarks';
import { projectToView, type ViewProjection } from './project';
import { createBodyMask, updateBodyMask, type BodyMask } from '../render/bodyMask';

export type TrackerStatus = 'idle' | 'loading' | 'ready' | 'denied' | 'error';

export interface PoseTracker {
  status: TrackerStatus;
  error: string | null;
  /** Latest smoothed pose in view pixels. A ref, so the loop never re-renders. */
  poseRef: React.RefObject<Pose>;
  /** Latest body silhouette, used to clip the garment. Null until first frame. */
  maskRef: React.RefObject<BodyMask | null>;
  /** Runs the pipeline over a still image instead of the camera. */
  detectStill: (image: HTMLImageElement, projection: ViewProjection) => Promise<boolean>;
  start: () => Promise<void>;
  stop: () => void;
}

/** Inference is capped below the display refresh rate to keep laptops cool. */
const TARGET_FPS = 30;

/**
 * MediaPipe's own default. Kept explicit because it is the number to reach for
 * when someone reports the app not seeing them - lowering it makes detection
 * more forgiving in poor light, at the cost of more false positives.
 */
const DETECTION_CONFIDENCE = 0.5;

/**
 * Which BlazePose weights to serve: 'lite' (5.8MB), 'full' (9.4MB) or
 * 'heavy' (30MB). Full is the default - noticeably steadier landmarks than
 * lite on real bodies for a few extra megabytes, where heavy costs a long
 * first load for little more. Synced by scripts/sync-assets.mjs.
 */
const POSE_MODEL: 'lite' | 'full' | 'heavy' = 'full';

/**
 * Extension the model is served under.
 *
 * Normally '.task', as MediaPipe ships it. Some static hosts only serve a
 * fixed set of extensions and refuse unknown ones; set VITE_POSE_MODEL_EXT at
 * build time to whatever that host does serve, and rename the file to match.
 * The bytes are fetched as an ArrayBuffer either way, so the name is all that
 * changes.
 */
const MODEL_EXT = import.meta.env.VITE_POSE_MODEL_EXT ?? '.task';

export function usePoseTracker(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  getProjection: () => ViewProjection | null,
): PoseTracker {
  const [status, setStatus] = useState<TrackerStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const poseRef = useRef<Pose>(emptyPose());
  const landmarkerRef = useRef<PoseLandmarker | null>(null);
  const maskRef = useRef<BodyMask | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastInferenceRef = useRef(0);
  const filtersRef = useRef<OneEuroState[]>(
    Array.from({ length: KEYPOINT_COUNT * 2 }, () => createOneEuroState()),
  );

  const stop = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    landmarkerRef.current?.close();
    landmarkerRef.current = null;
    setStatus('idle');
  }, []);

  /**
   * Builds a landmarker. Shared by the live and still paths so both get the
   * same thresholds, the same mask output and the same delegate fallback.
   */
  const createLandmarker = useCallback(async (mode: 'VIDEO' | 'IMAGE') => {
    const fileset = await FilesetResolver.forVisionTasks(
      `${import.meta.env.BASE_URL}wasm`,
    );
    const modelAssetPath = `${import.meta.env.BASE_URL}models/pose_landmarker_${POSE_MODEL}${MODEL_EXT}`;
    const options = {
      runningMode: mode,
      numPoses: 1,
      outputSegmentationMasks: true,
      minPoseDetectionConfidence: DETECTION_CONFIDENCE,
      minPosePresenceConfidence: DETECTION_CONFIDENCE,
      minTrackingConfidence: DETECTION_CONFIDENCE,
    };
    // The GPU delegate needs WebGL2, which some browsers and locked-down
    // machines do not offer. Fall back to CPU rather than failing outright.
    try {
      return await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate: 'GPU' },
        ...options,
      });
    } catch {
      return await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate: 'CPU' },
        ...options,
      });
    }
  }, []);

  /**
   * Runs the same pipeline over one still image.
   *
   * Exists because a camera is not always available - no webcam, a refused
   * permission, or a sandbox that withholds the device - and because a
   * full-length photo often frames the body better than a laptop webcam.
   */
  const detectStill = useCallback(
    async (image: HTMLImageElement, projection: ViewProjection) => {
      setStatus('loading');
      setError(null);
      try {
        const landmarker = await createLandmarker('IMAGE');
        const result = landmarker.detect(image);
        const landmarks = result.landmarks[0];

        const segmentation = result.segmentationMasks?.[0];
        if (segmentation != null) {
          if (
            maskRef.current == null ||
            maskRef.current.width !== segmentation.width ||
            maskRef.current.height !== segmentation.height
          ) {
            maskRef.current = createBodyMask(segmentation.width, segmentation.height);
          }
          updateBodyMask(maskRef.current, segmentation.getAsFloat32Array());
          segmentation.close();
        }

        if (landmarks == null) {
          poseRef.current = emptyPose();
          landmarker.close();
          setStatus('ready');
          return false;
        }

        // A still has no history, so the smoothing filter is bypassed: there
        // is nothing to smooth and seeding it would bias the first live frame.
        poseRef.current = toPose(landmarks).map((kp) => {
          const p = projectToView(kp.x, kp.y, projection);
          return { x: p.x, y: p.y, score: kp.score };
        });

        landmarker.close();
        setStatus('ready');
        return true;
      } catch (err) {
        setStatus('error');
        setError(err instanceof Error ? err.message : String(err));
        return false;
      }
    },
    [createLandmarker],
  );

  const start = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;

      const video = videoRef.current;
      if (video == null) throw new Error('Preview element is not mounted.');
      video.srcObject = stream;
      await video.play();

      // WASM runtime and model are both served from this origin, so the app
      // works offline and nothing about the wearer leaves the device.
      landmarkerRef.current = await createLandmarker('VIDEO');

      setStatus('ready');

      const loop = () => {
        rafRef.current = requestAnimationFrame(loop);

        const landmarker = landmarkerRef.current;
        const el = videoRef.current;
        const projection = getProjection();
        if (landmarker == null || el == null || projection == null) return;
        if (el.readyState < 2 || el.videoWidth === 0) return;

        const now = performance.now();
        if (now - lastInferenceRef.current < 1000 / TARGET_FPS) return;
        lastInferenceRef.current = now;

        const result = landmarker.detectForVideo(el, now);
        const landmarks = result.landmarks[0];
        if (landmarks == null) return;

        const segmentation = result.segmentationMasks?.[0];
        if (segmentation != null) {
          if (
            maskRef.current == null ||
            maskRef.current.width !== segmentation.width ||
            maskRef.current.height !== segmentation.height
          ) {
            maskRef.current = createBodyMask(segmentation.width, segmentation.height);
          }
          updateBodyMask(maskRef.current, segmentation.getAsFloat32Array());
          // MediaPipe reuses its buffers, so the mask has to be released.
          segmentation.close();
        }

        const raw = toPose(landmarks);
        const states = filtersRef.current;
        const next: Pose = [];
        for (let i = 0; i < raw.length; i++) {
          const kp = raw[i]!;
          const projected = projectToView(kp.x, kp.y, projection);
          const xState = states[i * 2]!;
          const yState = states[i * 2 + 1]!;
          next.push({
            x: filterOneEuro(xState, projected.x, now),
            y: filterOneEuro(yState, projected.y, now),
            score: kp.score,
          });
        }
        poseRef.current = next;
      };
      loop();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // A refused camera is a choice, not a fault - the UI says so differently.
      const denied = err instanceof DOMException && err.name === 'NotAllowedError';
      setStatus(denied ? 'denied' : 'error');
      setError(message);
    }
  }, [createLandmarker, getProjection, videoRef]);

  useEffect(() => stop, [stop]);

  return { status, error, poseRef, maskRef, detectStill, start, stop };
}
