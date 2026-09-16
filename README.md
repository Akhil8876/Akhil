# MirrorFit

A mobile virtual try-on app. Point the front camera at yourself and clothing is
tracked onto your body in real time, with a size recommendation derived from
your own proportions.

Everything runs on-device. No frame, photo or measurement is uploaded anywhere.

## How it works

```
Camera frame  ->  centre-square crop  ->  MoveNet Lightning  ->  17 landmarks
                                                                     |
                     garment artwork  <-  affine fit solve  <-  One Euro filter
                                                |
                                          Skia overlay on the preview
```

1. **Capture** - `react-native-vision-camera` delivers frames; a frame processor
   runs on its own thread so the preview never stalls.
2. **Pose** - MoveNet SinglePose Lightning (`react-native-fast-tflite`) returns
   17 landmarks per frame. Inference is capped at 30fps while the preview runs
   free; see `INFERENCE_FPS` in `src/pose/usePoseDetector.ts`.
3. **Smooth** - a One Euro filter (`src/utils/oneEuro.ts`) removes shimmer when
   you hold still without adding lag when you move.
4. **Fit** - `src/fit/solveFit.ts` anchors the garment at your shoulder
   midpoint, rotates it to your shoulder line, and scales it across by shoulder
   breadth and down by torso length.
5. **Render** - a Skia canvas draws the garment over the preview. The whole
   landmark-to-pixel path stays on the UI thread, so the garment is locked to
   your body rather than trailing it.

### Coordinate spaces

The one genuinely fiddly part. `src/pose/projection.ts` names four spaces -
BUFFER, SQUARE, UPRIGHT, VIEW - and documents the transform between them. The
convention is that `rotationForOrientation` returns the degrees the camera
buffer must be rotated **clockwise** to appear upright.

If the overlay is ever rotated or mirrored on a particular device, that rotation
table is what needs adjusting; the fitting maths is orientation-agnostic. Flip
on the **Skeleton** toggle in the top bar to see the raw landmarks and confirm.

### Sizing

A single camera cannot recover absolute scale, so sizing is pinned to one number
you supply: your height. With your feet in frame the app measures your pixel
height directly and converts shoulder breadth to centimetres; with only your
torso visible it falls back to a population ratio and labels the result
*estimated* rather than presenting it as a measurement. See `src/fit/measure.ts`
for the constants and where they come from.

## Getting started

Requires a **physical device**. Camera frame processors do not work in the iOS
Simulator or the Android emulator, and Expo Go cannot load the native modules
this app needs - it uses a development build.

```bash
npm install
npm run prebuild          # generate the native ios/ and android/ projects
npm run ios               # or: npm run android
```

The pose model is committed at `assets/models/movenet-lightning.tflite` so a
fresh clone builds offline. To refresh it: `npm run fetch-model`.

## Development

```bash
npm test          # geometry tests - projection, fit solve, sizing, smoothing
npm run typecheck # tsc, strict
npm run gen-assets # regenerate the placeholder garment artwork
```

The fitting maths has no React Native imports, so `npm test` bundles it with
esbuild and runs it under `node:test` - no simulator, ~100ms.

## Adding a garment

1. Drop a transparent cut-out in `assets/garments/`, drawn flat-lay, facing
   forward and head-up.
2. Measure three numbers in artwork pixels: the shoulder-seam midpoint, the
   width between shoulder seams, and shoulder line to hem.
3. Add an entry to `src/catalog/garments.ts` with those anchors, plus
   `shoulderEase` / `lengthEase` for how the piece is cut relative to the body.

No code changes are needed - one fit solver serves every garment.

The eight garments bundled today are generated placeholders
(`scripts/generate_garments.py`), not product photography. They are there so the
app is usable end to end; swap them for real cut-outs and only the anchor
numbers change.

## Known limitations

- **2D overlay, not cloth simulation.** Garments are warped onto the torso, so
  they read well from the front and degrade as you turn. `solveFit` rejects
  poses more oblique than `MIN_ASPECT` rather than drawing something wrong.
- **No occlusion.** The garment draws over your arms when they cross your body;
  fixing this needs a segmentation mask in addition to the pose.
- **Snapshot capture on Android.** `react-native-view-shot` captures the camera
  preview through a `SurfaceView`, which yields a black frame on some Android
  devices. iOS is unaffected. A robust fix is to composite the overlay onto a
  `takePhoto()` still rather than screenshotting the preview.
- **Single person.** MoveNet SinglePose tracks one body; the most prominent
  subject wins.
- **Sizing is an estimate,** not a tailor. See `src/fit/measure.ts`.

## Licence

App code is yours. The bundled pose model is MoveNet SinglePose Lightning,
redistributed from [google-coral/test_data](https://github.com/google-coral/test_data)
under the Apache License 2.0.
