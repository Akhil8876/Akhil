/**
 * Canvas 2D rendering of the garment and the debug skeleton.
 *
 * The transform chain is the same one the React Native app applies through
 * Skia - anchor at the shoulder midpoint, rotate to the shoulder line, scale
 * across by breadth and down by torso length. Canvas rotates clockwise on a
 * y-down surface exactly as Skia does, so `solveFit` output drops straight in.
 */
import { solveFit } from '@shared/fit/solveFit';
import { KP, MIN_KEYPOINT_SCORE, type Pose } from '@shared/pose/keypoints';
import type { GarmentAnchors } from '@shared/catalog/types';
import { drawMesh } from './meshWarp';
import { taperAt, torsoTaperFromPose } from '@shared/fit/torsoTaper';
import type { ViewProjection } from '../pose/project';

export interface DrawGarmentOptions {
  pose: Pose;
  image: CanvasImageSource;
  anchors: GarmentAnchors;
  shoulderEase: number;
  lengthEase: number;
  fitTrim: number;
  /** Scales view coordinates into the target surface, 1 for the live preview. */
  scale?: number;
  /**
   * Preview geometry. Given this the garment is warped onto the torso;
   * without it, it falls back to a rigid transform.
   */
  projection?: ViewProjection | null;
}

/**
 * Scratch surface for the warped garment.
 *
 * The mesh is drawn here at full opacity and composited once. Applying the
 * confidence alpha per triangle instead would blend every overlapping edge
 * twice and leave a lattice of diagonal seams across the fabric.
 */
let warpLayer: HTMLCanvasElement | null = null;

function getWarpLayer(width: number, height: number): CanvasRenderingContext2D | null {
  if (warpLayer == null) warpLayer = document.createElement('canvas');
  if (warpLayer.width !== width || warpLayer.height !== height) {
    warpLayer.width = width;
    warpLayer.height = height;
  }
  const ctx = warpLayer.getContext('2d');
  if (ctx == null) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

/** Mesh density. Enough to bend smoothly, few enough to stay cheap. */
const MESH_COLS = 12;
const MESH_ROWS = 16;

/**
 * How far the garment is pulled toward the wearer's own taper: 0 keeps the
 * flat artwork's shape, 1 matches the torso exactly. Short of 1 because
 * clothing hangs off a body rather than shrink-wrapping it, and because the
 * artwork already carries some shaping of its own.
 */
const CONFORM = 0.7;

/**
 * Cylindrical bow, as a fraction of the garment's half-width. A torso is
 * round, so a hem or a collar band that is straight on the flat pattern
 * should sag toward the viewer at the centre.
 */
const BOW = 0.06;

/** Returns true when a garment was actually drawn. */
export function drawGarment(
  ctx: CanvasRenderingContext2D,
  options: DrawGarmentOptions,
): boolean {
  const fit = solveFit(options.pose, options.anchors, {
    shoulderEase: options.shoulderEase,
    lengthEase: options.lengthEase,
    userScale: options.fitTrim,
  });
  if (fit == null) return false;

  const scale = options.scale ?? 1;
  const { anchors, projection } = options;
  const taper = torsoTaperFromPose(options.pose);

  const alpha = Math.max(0, Math.min(1, fit.confidence));

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.scale(scale, scale);

  if (taper == null || projection == null) {
    // No silhouette yet: place it rigidly rather than not at all.
    ctx.translate(fit.originX, fit.originY);
    ctx.rotate(fit.rotation);
    ctx.scale(fit.scaleX, fit.scaleY);
    ctx.translate(-fit.anchorX, -fit.anchorY);
    ctx.drawImage(options.image, 0, 0, anchors.width, anchors.height);
    ctx.restore();
    return true;
  }

  const cos = Math.cos(fit.rotation);
  const sin = Math.sin(fit.rotation);

  /** Artwork pixels -> view pixels, the rigid placement the warp starts from. */
  const rigid = (ax: number, ay: number) => {
    const x = (ax - fit.anchorX) * fit.scaleX;
    const y = (ay - fit.anchorY) * fit.scaleY;
    return { x: fit.originX + x * cos - y * sin, y: fit.originY + x * sin + y * cos };
  };

  const map = (u: number, v: number) => {
    const p = rigid(u * anchors.width, v * anchors.height);

    // Split the offset into across-the-shoulders and down-the-torso.
    const dx = p.x - fit.originX;
    const dy = p.y - fit.originY;
    const across = dx * cos + dy * sin;
    const along = -dx * sin + dy * cos;

    // Narrow the garment exactly where the torso narrows.
    const ratio = taperAt(taper, Math.max(0, along));
    const warpedAcross = across * (1 + (ratio - 1) * CONFORM);

    // A torso is round, so a band that is straight on the flat pattern should
    // sag toward the viewer at the centre.
    const halfSpan = (anchors.shoulderWidth / 2) * fit.scaleX;
    const bow = halfSpan > 0
      ? BOW * halfSpan * Math.cos(Math.min(1, Math.abs(warpedAcross) / halfSpan) * (Math.PI / 2))
      : 0;
    const warpedAlong = along + bow;

    return {
      x: fit.originX + warpedAcross * cos - warpedAlong * sin,
      y: fit.originY + warpedAcross * sin + warpedAlong * cos,
    };
  };

  // Warp at full opacity on its own surface, then lay it down once.
  const width = Math.max(1, Math.round(projection.viewWidth * scale));
  const height = Math.max(1, Math.round(projection.viewHeight * scale));
  const layer = getWarpLayer(width, height);
  if (layer == null) {
    ctx.restore();
    return false;
  }
  layer.scale(scale, scale);
  drawMesh(layer, options.image, anchors.width, anchors.height, MESH_COLS, MESH_ROWS, map);

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = alpha;
  ctx.drawImage(layer.canvas, 0, 0);
  ctx.restore();

  return true;
}

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
 * Draws the raw landmarks. The fastest way to tell a tracking problem from a
 * fitting problem: if the skeleton follows the wearer, the garment will too.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  color = '#E8D5B7',
): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';

  ctx.beginPath();
  for (const [from, to] of BONES) {
    const a = pose[from];
    const b = pose[to];
    if (a == null || b == null) continue;
    if (a.score < MIN_KEYPOINT_SCORE || b.score < MIN_KEYPOINT_SCORE) continue;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();

  for (const kp of pose) {
    if (kp.score < MIN_KEYPOINT_SCORE) continue;
    ctx.beginPath();
    ctx.arc(kp.x, kp.y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
