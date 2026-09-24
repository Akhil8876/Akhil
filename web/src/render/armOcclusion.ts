/**
 * Cuts the garment away where an arm passes in front of it.
 *
 * The approach taken by most 2D try-on code is to stroke a thick line along
 * the arm bones and subtract that. It works, but a stroked capsule is a crude
 * stand-in for an arm: too fat and it eats the garment, too thin and it leaves
 * fabric over the skin.
 *
 * Because the pose model already hands us a segmentation mask, we can do
 * better - intersect the stroked arm with the wearer's actual silhouette, so
 * the cut follows the real outline of the limb. The stroke only has to say
 * *which* part of the body is the arm; the mask supplies its shape.
 *
 * Restricted to the torso quad so long sleeves survive: an arm at the wearer's
 * side is beside the torso, not in front of it. See src/fit/armOcclusion.ts.
 */
import type { Pose } from '@shared/pose/keypoints';
import {
  anyForearmOverTorso,
  armThickness,
  forearms,
  torsoQuad,
  withHand,
} from '@shared/fit/armOcclusion';
import type { BodyMask } from './bodyMask';

export interface MaskPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  mirrored: boolean;
}

/** Softens the cut so skin meets fabric rather than being scissored out of it. */
const FEATHER_PX = 2.5;

/**
 * Grows the torso quad before clipping. The shoulder and hip landmarks sit
 * inside the body, so the raw quad stops short of the wearer's actual sides
 * and would leave a rim of fabric over a crossing arm.
 */
const TORSO_MARGIN = 1.18;

let stencil: HTMLCanvasElement | null = null;

function getStencil(width: number, height: number): CanvasRenderingContext2D | null {
  if (stencil == null) stencil = document.createElement('canvas');
  if (stencil.width !== width || stencil.height !== height) {
    stencil.width = width;
    stencil.height = height;
  }
  const ctx = stencil.getContext('2d');
  if (ctx == null) return null;
  // A canvas context is stateful and this one is reused every frame. Transform,
  // composite mode and filter all have to be put back explicitly, and the clip
  // can only be dropped by restoring - which is why the caller wraps its work
  // in save()/restore(). Leaving destination-in set here meant the next frame's
  // stroke was composited against an empty canvas and vanished.
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

/**
 * Erases the arms from a garment layer.
 *
 * @param ctx    the garment layer, already drawn and clipped to the body
 * @param scale  view points to layer pixels
 * @returns whether anything was cut
 */
export function cutOutArms(
  ctx: CanvasRenderingContext2D,
  pose: Pose,
  mask: BodyMask | null,
  placement: MaskPlacement,
  layerWidth: number,
  layerHeight: number,
  scale: number,
): boolean {
  // Most frames have both arms hanging; skip the whole stencil for those.
  if (!anyForearmOverTorso(pose)) return false;

  const quad = torsoQuad(pose);
  const thickness = armThickness(pose);
  if (quad == null || thickness <= 0) return false;

  const s = getStencil(layerWidth, layerHeight);
  if (s == null) return false;

  s.save();
  s.scale(scale, scale);

  // Grow the torso quad about its own centre, then keep the cut inside it.
  const cx = (quad[0].x + quad[1].x + quad[2].x + quad[3].x) / 4;
  const cy = (quad[0].y + quad[1].y + quad[2].y + quad[3].y) / 4;
  s.beginPath();
  quad.forEach((p, i) => {
    const x = cx + (p.x - cx) * TORSO_MARGIN;
    const y = cy + (p.y - cy) * TORSO_MARGIN;
    if (i === 0) s.moveTo(x, y);
    else s.lineTo(x, y);
  });
  s.closePath();
  s.clip();

  s.strokeStyle = '#fff';
  s.lineCap = 'round';
  s.lineJoin = 'round';
  s.lineWidth = thickness;
  s.beginPath();
  for (const arm of forearms(pose)) {
    const extended = withHand(arm, thickness);
    s.moveTo(extended.from.x, extended.from.y);
    s.lineTo(extended.to.x, extended.to.y);
  }
  s.stroke();

  // Keep only the part of the stroke that is actually body, so the cut takes
  // the arm's real outline rather than a capsule's.
  if (mask != null) {
    s.setTransform(1, 0, 0, 1, 0, 0);
    s.globalCompositeOperation = 'destination-in';
    if (placement.mirrored) {
      s.translate((placement.x * 2 + placement.width) * scale, 0);
      s.scale(-1, 1);
    }
    s.drawImage(
      mask.canvas,
      placement.x * scale,
      placement.y * scale,
      placement.width * scale,
      placement.height * scale,
    );
  }
  s.restore();

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.filter = `blur(${FEATHER_PX}px)`;
  ctx.drawImage(s.canvas, 0, 0);
  ctx.restore();
  return true;
}
