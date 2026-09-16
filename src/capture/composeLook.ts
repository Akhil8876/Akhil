/**
 * Composites a saved look from a full-resolution still.
 *
 * Screenshotting the preview does not work: the camera renders into a
 * SurfaceView, which a view-hierarchy capture reads back as an empty black
 * rectangle on many Android devices. So instead of photographing the screen we
 * rebuild the screen - take a real still with `takePhoto()`, crop it exactly
 * the way the preview cropped it, and draw the garment back on top at the same
 * place the wearer saw it.
 *
 * That also means the snapshot is at sensor resolution rather than screen
 * resolution, so a saved look is sharper than the preview it came from.
 */
import { Skia, ImageFormat, type SkCanvas, type SkImage } from '@shopify/react-native-skia';
import { File, Paths } from 'expo-file-system';

import type { GarmentAnchors } from '../catalog/types';
import type { GarmentTransform } from '../fit/solveFit';
import type { FrameOrientation, ViewSize } from '../pose/projection';
import {
  computeOutputSize,
  garmentTransform,
  photoTransform,
  resolvePhotoOrientation,
  uprightPhotoSize,
  type CanvasOp,
} from './geometry';

/**
 * Upper bound on the composited canvas. A 48MP still would otherwise ask for a
 * surface large enough that allocation fails on mid-range GPUs.
 */
const MAX_OUTPUT_WIDTH = 2048;

const JPEG_QUALITY = 92;

export interface ComposeLookParams {
  /** Absolute path from `PhotoFile.path` - no `file://` prefix on either OS. */
  photoPath: string;
  photoWidth: number;
  photoHeight: number;
  photoOrientation: FrameOrientation;
  /** `PhotoFile.isMirrored`. Front-camera stills are mirrored by default. */
  photoIsMirrored: boolean;
  /** Whether the preview the wearer saw was mirrored. */
  previewMirrored: boolean;
  /** Size of the on-screen preview, the space `fit` is expressed in. */
  view: ViewSize;
  /** Garment placement solved at shutter time, in VIEW coordinates. */
  fit: GarmentTransform | null;
  garmentImage: SkImage;
  garmentAnchors: GarmentAnchors;
}

/** Replays a transform chain from `geometry.ts` onto a real canvas. */
function applyOps(canvas: SkCanvas, ops: CanvasOp[]): void {
  for (const step of ops) {
    switch (step.op) {
      case 'translate':
        canvas.translate(step.x, step.y);
        break;
      case 'scale':
        canvas.scale(step.x, step.y);
        break;
      case 'rotate':
        canvas.rotate(step.degrees, 0, 0);
        break;
    }
  }
}

/** Draws the still, cropped and oriented exactly as the preview showed it. */
function drawPhoto(
  canvas: SkCanvas,
  photo: SkImage,
  params: ComposeLookParams,
  orientation: FrameOrientation,
  output: { width: number; height: number },
): void {
  // Trust the decoded image for dimensions: the declared ones can disagree
  // when the decoder has already applied the EXIF orientation.
  const width = photo.width();
  const height = photo.height();
  const paint = Skia.Paint();

  canvas.save();
  applyOps(
    canvas,
    photoTransform({
      photoWidth: width,
      photoHeight: height,
      orientation,
      // The still is mirrored for front cameras by default, so usually there
      // is nothing to do here - but the camera's `isMirrored` prop can be
      // overridden, and the photo reports what it actually did.
      mirror: params.photoIsMirrored !== params.previewMirrored,
      output,
    }),
  );

  const rect = Skia.XYWHRect(0, 0, width, height);
  canvas.drawImageRect(photo, rect, rect, paint);
  canvas.restore();
}

/**
 * Draws the garment using the same transform the live overlay used.
 *
 * Scaling the canvas into VIEW units first means this is the identical
 * sequence from `GarmentOverlay`, so the still cannot drift from the preview.
 */
function drawGarment(canvas: SkCanvas, params: ComposeLookParams, scale: number): void {
  const { fit, garmentAnchors, garmentImage } = params;
  if (fit == null) return;

  const paint = Skia.Paint();
  paint.setAlphaf(Math.max(0, Math.min(1, fit.confidence)));

  canvas.save();
  applyOps(canvas, garmentTransform(fit, scale));

  const rect = Skia.XYWHRect(0, 0, garmentAnchors.width, garmentAnchors.height);
  canvas.drawImageRect(garmentImage, rect, rect, paint);
  canvas.restore();
}

/**
 * Renders the look and writes it to the cache directory.
 *
 * @returns a `file://` URI, or throws if the still could not be decoded.
 */
export async function composeLook(params: ComposeLookParams): Promise<string> {
  // `PhotoFile.path` is a plain path; Skia wants a URI.
  const uri = params.photoPath.startsWith('file://')
    ? params.photoPath
    : `file://${params.photoPath}`;

  const data = await Skia.Data.fromURI(uri);
  const photo = Skia.Image.MakeImageFromEncoded(data);
  if (photo == null) {
    throw new Error('Could not decode the captured photo.');
  }

  // Sizing has to wait until after decoding: if the decoder applied the EXIF
  // orientation itself, the dimensions the camera reported are transposed.
  const orientation = resolvePhotoOrientation(
    params.photoWidth,
    params.photoHeight,
    photo.width(),
    photo.height(),
    params.photoOrientation,
  );
  const upright = uprightPhotoSize(photo.width(), photo.height(), orientation);
  const output = computeOutputSize(params.view, upright.width, MAX_OUTPUT_WIDTH);
  if (output.width <= 0 || output.height <= 0) {
    throw new Error('Preview has no size yet - nothing to compose.');
  }

  const surface = Skia.Surface.MakeOffscreen(output.width, output.height);
  if (surface == null) {
    throw new Error(`Could not allocate a ${output.width}x${output.height} surface.`);
  }

  const canvas = surface.getCanvas();
  canvas.drawColor(Skia.Color('black'));
  drawPhoto(canvas, photo, params, orientation, output);
  drawGarment(canvas, params, output.scale);
  surface.flush();

  const snapshot = surface.makeImageSnapshot();
  const bytes = snapshot.encodeToBytes(ImageFormat.JPEG, JPEG_QUALITY);
  if (bytes == null) {
    throw new Error('Could not encode the composed look.');
  }

  const file = new File(Paths.cache, `look-${Date.now()}.jpg`);
  file.create({ overwrite: true });
  file.write(bytes);

  return file.uri;
}
