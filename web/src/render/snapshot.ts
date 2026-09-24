/**
 * Composites a saved look.
 *
 * On the web this is the easy case the React Native app had to work around:
 * a <video> element can be drawn straight onto a canvas, so the snapshot is
 * the video frame plus the garment, at video resolution, with no screenshot
 * of the page involved.
 */
import { drawGarment, type DrawGarmentOptions } from './drawOverlay';
import { coverTransform, type ViewProjection } from '../pose/project';

export interface SnapshotOptions extends Omit<DrawGarmentOptions, 'scale'> {
  video: HTMLVideoElement;
  projection: ViewProjection;
  /** Cap on the output width, so a 4K webcam does not produce a huge blob. */
  maxWidth?: number;
}

const DEFAULT_MAX_WIDTH = 1440;

/** Renders the look and resolves to a JPEG blob URL. */
export async function composeLook(options: SnapshotOptions): Promise<string> {
  const { video, projection } = options;
  const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;

  if (projection.viewWidth <= 0 || projection.viewHeight <= 0) {
    throw new Error('The preview has no size yet.');
  }

  // Keep the preview's aspect ratio so the snapshot frames what was on screen,
  // and size it to the video rather than the page for a sharper result.
  const width = Math.round(
    Math.min(Math.max(projection.videoWidth, projection.viewWidth), maxWidth),
  );
  const height = Math.round(width * (projection.viewHeight / projection.viewWidth));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx == null) throw new Error('Could not get a 2D drawing context.');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  // Reuse the preview's own cover transform, scaled from CSS pixels to output
  // pixels, so the snapshot crops exactly where the preview cropped.
  const outputScale = width / projection.viewWidth;
  const { scale, offsetX, offsetY } = coverTransform(projection);

  ctx.save();
  if (projection.mirrored) {
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(
    video,
    offsetX * outputScale,
    offsetY * outputScale,
    projection.videoWidth * scale * outputScale,
    projection.videoHeight * scale * outputScale,
  );
  ctx.restore();

  drawGarment(ctx, { ...options, scale: outputScale });

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/jpeg', 0.92),
  );
  if (blob == null) throw new Error('Could not encode the snapshot.');
  return URL.createObjectURL(blob);
}
