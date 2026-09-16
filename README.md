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

### Saving a look

Snapshots do not screenshot the screen. The camera renders into a `SurfaceView`,
which a view-hierarchy capture reads back as a black rectangle on many Android
devices, so instead of photographing the preview the app rebuilds it:

1. `takePhoto()` for a real still at sensor resolution.
2. Crop it exactly the way the preview cropped it - same cover crop, same
   orientation, same mirroring.
3. Draw the garment back on with the transform solved at the shutter, scaled
   from view points into output pixels.

Because step 3 replays the identical transform chain the live overlay uses, the
still cannot drift from what you saw - and it comes out sharper than the preview,
since it is composited at the photo's resolution rather than the screen's.

The transform chains live in `src/capture/geometry.ts` as plain data
(`CanvasOp[]`), which is what lets `tests/capture.test.ts` replay them through
an ordinary affine matrix and assert the real invariants - the subject stays
centred, the frame is covered with no blank edges, nothing is stretched - with
no GPU involved. `src/capture/composeLook.ts` is then a thin applier over Skia.

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
npm run android           # or: npm run ios  (macOS only)
```

| Platform | Host OS | Also needs |
| --- | --- | --- |
| Android | Windows, macOS, Linux | Android Studio (or JDK 17 + platform-tools), USB debugging enabled |
| iOS | macOS only | Xcode. A free Apple ID works; builds expire after 7 days |

All scripts are Node-based and run the same in PowerShell, cmd, bash and zsh.

The pose model is committed at `assets/models/movenet-lightning.tflite` so a
fresh clone builds offline. To refresh it: `npm run fetch-model`.

## Development

```bash
npm run verify     # typecheck + tests + bundle both platforms
npm test           # geometry tests - projection, fit solve, sizing, smoothing, capture
npm run typecheck  # tsc, strict
npm run bundle     # Metro bundle for iOS and Android, catches import/asset errors
npm run gen-assets # regenerate the placeholder garment artwork
```

The fitting maths has no React Native imports, so `npm test` bundles it with
esbuild and runs it under `node:test` - no simulator, ~100ms.

Regenerating the artwork needs Python 3 with Pillow (`pip install pillow`);
everything else is Node only.

`npm run bundle` is the useful check before touching a device: it runs the real
Metro pipeline, so it catches unresolved imports, missing assets and Babel
plugin problems in about a minute, none of which need hardware.

### Worklet plugins

Two worklet runtimes are in play and both Babel plugins are required:
VisionCamera frame processors compile against `react-native-worklets-core`,
while Reanimated 4 uses `react-native-worklets`. Reanimated's plugin must stay
last in `babel.config.js`. If the camera runs but no pose ever appears, a
missing or misordered plugin is the first thing to check - the `'worklet'`
directive silently fails to compile rather than erroring.

`metro.config.js` registers `.tflite` as an asset extension; without it Metro
tries to parse the pose model as JavaScript.

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
- **Shutter latency.** The garment is placed using the pose as of the shutter,
  but `takePhoto()` returns a frame captured a moment later. Moving quickly as
  you tap will show a small offset.
- **Single person.** MoveNet SinglePose tracks one body; the most prominent
  subject wins.
- **Sizing is an estimate,** not a tailor. See `src/fit/measure.ts`.

## Licence

App code is yours. The bundled pose model is MoveNet SinglePose Lightning,
redistributed from [google-coral/test_data](https://github.com/google-coral/test_data)
under the Apache License 2.0.
