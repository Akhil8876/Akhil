import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { emptyPose, hasTorso, type Pose } from '@shared/pose/keypoints';
import { solveFit } from '@shared/fit/solveFit';
import {
  anyForearmOverTorso, torsoQuad, forearms, armThickness,
} from '@shared/fit/armOcclusion';
import { measureBody, recommendSize } from '@shared/fit/measure';
import { GARMENTS, garmentById } from './catalog';
import { usePoseTracker } from './pose/usePoseTracker';
import { coverTransform, type ViewProjection } from './pose/project';
import { drawGarment, drawSkeleton } from './render/drawOverlay';
import { clipToBody } from './render/bodyMask';
import { cutOutArms } from './render/armOcclusion';
import { composeLook } from './render/snapshot';
import { GarmentRail } from './components/GarmentRail';
import { FitPanel } from './components/FitPanel';

/** Sizing only needs a coarse update; the overlay runs at frame rate. */
const MEASURE_INTERVAL_MS = 400;

interface Look {
  id: string;
  url: string;
  garmentId: string;
  sizeLabel: string | null;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  // Garments are drawn here first so the silhouette can clip them before they
  // reach the visible canvas.
  const scratchRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());

  const [activeId, setActiveId] = useState(GARMENTS[0]!.id);
  const [heightCm, setHeightCm] = useState(173);
  const [fitTrim, setFitTrim] = useState(1);
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [looks, setLooks] = useState<Look[]>([]);
  const [sampledPose, setSampledPose] = useState<Pose>(() => emptyPose());

  const garment = garmentById(activeId) ?? GARMENTS[0]!;

  // Decode every garment once up front; swapping should be instant.
  useEffect(() => {
    for (const g of GARMENTS) {
      if (imagesRef.current.has(g.id)) continue;
      const img = new Image();
      img.src = g.imageUrl;
      imagesRef.current.set(g.id, img);
    }
  }, []);

  const getProjection = useCallback((): ViewProjection | null => {
    const video = videoRef.current;
    const stage = stageRef.current;
    if (video == null || stage == null || video.videoWidth === 0) return null;
    const rect = stage.getBoundingClientRect();
    return {
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      viewWidth: rect.width,
      viewHeight: rect.height,
      mirrored: true,
    };
  }, []);

  const tracker = usePoseTracker(videoRef, getProjection);

  // Draw loop, independent of React rendering.
  useEffect(() => {
    if (tracker.status !== 'ready') return;
    let raf = 0;

    const render = () => {
      raf = requestAnimationFrame(render);
      const canvas = canvasRef.current;
      const projection = getProjection();
      if (canvas == null || projection == null) return;

      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(projection.viewWidth * dpr);
      const height = Math.round(projection.viewHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }

      const ctx = canvas.getContext('2d');
      if (ctx == null) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, projection.viewWidth, projection.viewHeight);

      const image = imagesRef.current.get(garment.id);
      const pose = tracker.poseRef.current;
      if (image != null && image.complete) {
        if (scratchRef.current == null) scratchRef.current = document.createElement('canvas');
        const scratch = scratchRef.current;
        if (scratch.width !== width || scratch.height !== height) {
          scratch.width = width;
          scratch.height = height;
        }
        const sctx = scratch.getContext('2d');
        if (sctx != null) {
          sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          sctx.clearRect(0, 0, projection.viewWidth, projection.viewHeight);
          const drew = drawGarment(sctx, {
            pose,
            image,
            anchors: garment.anchors,
            shoulderEase: garment.shoulderEase,
            lengthEase: garment.lengthEase,
            fitTrim,
            projection,
          });

          const mask = tracker.maskRef.current;
          if (drew) {
            const { scale, offsetX, offsetY } = coverTransform(projection);
            const placement = {
              x: offsetX,
              y: offsetY,
              width: projection.videoWidth * scale,
              height: projection.videoHeight * scale,
              mirrored: projection.mirrored,
            };
            if (mask != null) clipToBody(sctx, mask, placement);
            // Arms last: they go in front of the garment, so they are cut
            // after the garment has been trimmed to the body.
            cutOutArms(sctx, pose, mask, placement, width, height, dpr);
          }

          if (drew) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.drawImage(scratch, 0, 0);
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          }
        }
      }
      if (showSkeleton) drawSkeleton(ctx, pose);

      if (import.meta.env.DEV) {
        // Dev-only probe so tests and the console can read what was solved,
        // without another render path that could disagree with this one.
        (window as unknown as Record<string, unknown>).__mirrorfit = {
          pose,
          projection,
          occlusion: {
            gate: anyForearmOverTorso(pose),
            quad: torsoQuad(pose) != null,
            forearms: forearms(pose).length,
            thickness: armThickness(pose),
          },
          fit: solveFit(pose, garment.anchors, {
            shoulderEase: garment.shoulderEase,
            lengthEase: garment.lengthEase,
            userScale: fitTrim,
          }),
        };
      }
    };

    render();
    return () => cancelAnimationFrame(raf);
  }, [tracker.status, tracker.poseRef, tracker.maskRef, garment, fitTrim, showSkeleton, getProjection]);

  // Slow sample for the size recommendation.
  useEffect(() => {
    if (tracker.status !== 'ready') return;
    const id = setInterval(() => setSampledPose(tracker.poseRef.current), MEASURE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [tracker.status, tracker.poseRef]);

  const measurements = useMemo(
    () => measureBody(sampledPose, heightCm),
    [sampledPose, heightCm],
  );
  const recommendation = useMemo(
    () => recommendSize(measurements, garment.sizes),
    [measurements, garment.sizes],
  );
  const tracking = hasTorso(sampledPose);

  const onCapture = useCallback(async () => {
    const video = videoRef.current;
    const projection = getProjection();
    const image = imagesRef.current.get(garment.id);
    if (video == null || projection == null || image == null) return;
    try {
      const url = await composeLook({
        video,
        projection,
        pose: tracker.poseRef.current,
        mask: tracker.maskRef.current,
        image,
        anchors: garment.anchors,
        shoulderEase: garment.shoulderEase,
        lengthEase: garment.lengthEase,
        fitTrim,
      });
      setLooks((prev) => [
        { id: `${Date.now()}`, url, garmentId: garment.id, sizeLabel: recommendation?.size.label ?? null },
        ...prev,
      ]);
    } catch (err) {
      console.error('Could not save look', err);
    }
  }, [garment, fitTrim, getProjection, recommendation, tracker.poseRef, tracker.maskRef]);

  const started = tracker.status === 'ready' || tracker.status === 'loading';

  return (
    <main className="app">
      <div className="stage" ref={stageRef}>
        <video ref={videoRef} className="preview" playsInline muted />
        <canvas ref={canvasRef} className="overlay" />

        {started ? (
          <div className="hud">
            <span className="pill">
              <i className={`dot ${tracking ? 'ok' : 'warn'}`} />
              {tracker.status === 'loading'
                ? 'Loading model'
                : tracking
                  ? 'Tracking'
                  : 'Step into frame'}
            </span>
            <button
              type="button"
              className="pill button"
              onClick={() => setShowSkeleton((v) => !v)}
              aria-pressed={showSkeleton}
            >
              Skeleton {showSkeleton ? 'on' : 'off'}
            </button>
          </div>
        ) : null}

        {!started ? (
          <div className="start">
            <h1>MirrorFit</h1>
            <p>
              Try clothes on using your camera. Everything runs on your device
              &mdash; no video is uploaded anywhere.
            </p>
            <button type="button" className="primary" onClick={() => void tracker.start()}>
              Turn on camera
            </button>
            {tracker.status === 'denied' ? (
              <p className="error">
                Camera access was refused. Allow it in your browser&rsquo;s address bar, then try again.
              </p>
            ) : null}
            {tracker.status === 'error' ? <p className="error">{tracker.error}</p> : null}
          </div>
        ) : null}
      </div>

      <aside className="sidebar">
        <GarmentRail garments={GARMENTS} activeId={activeId} onSelect={setActiveId} />

        <div className="actions">
          <button type="button" className="primary" onClick={() => void onCapture()} disabled={!tracking}>
            Save this look
          </button>
        </div>

        <FitPanel
          garment={garment}
          measurements={measurements}
          recommendation={recommendation}
          heightCm={heightCm}
          fitTrim={fitTrim}
          onHeightChange={setHeightCm}
          onTrimChange={setFitTrim}
        />

        {looks.length > 0 ? (
          <section className="panel">
            <h2>Your looks</h2>
            <div className="looks">
              {looks.map((look) => (
                <a key={look.id} href={look.url} download={`mirrorfit-${look.id}.jpg`}>
                  <img src={look.url} alt={`Saved look, size ${look.sizeLabel ?? 'unknown'}`} />
                </a>
              ))}
            </div>
          </section>
        ) : null}
      </aside>
    </main>
  );
}
