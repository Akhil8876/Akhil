# MirrorFit (web)

The browser version. Point your webcam at yourself and clothing is tracked onto
your body in real time, with a size recommendation from your own proportions.

Everything runs on your device. No frame, photo or measurement is uploaded
anywhere — the pose model and its WASM runtime are served from this origin, so
the app works offline once loaded.

## Run it

```bash
cd web
npm install
npm run dev
```

Open the printed URL and click **Turn on camera**. That is the whole setup —
no SDK, no emulator, no device.

Needs a browser with `getUserMedia` and WebAssembly: any current Chrome, Edge,
Firefox or Safari. Chrome and Safari require HTTPS or `localhost`, which `npm
run dev` gives you.

## Deploying

The app is fully static once built, so any static host works. On Vercel:

```bash
npx vercel --cwd web
```

Or import the repo in the Vercel dashboard and set **Root Directory** to
`web` — `web/vercel.json` supplies the rest (Vite preset, long cache headers
for the model and WASM, correct content type for `.task`).

Two things to know:

- The build is ~33MB, nearly all of it the pose model and the WASM runtime.
  That is static file weight, not bundle weight: the JS is 383KB.
- **Camera access needs HTTPS.** Every host gives you that, and `localhost` is
  exempt, but a plain-HTTP deploy will silently fail to open the camera.

## How it relates to the React Native app

The valuable half is shared verbatim, through the `@shared` alias into `../src`:

| Shared | Web-only |
| --- | --- |
| `fit/solveFit.ts` — garment placement | MediaPipe landmark adapter |
| `fit/measure.ts` — sizing from height | `getUserMedia` camera |
| `utils/oneEuro.ts` — jitter smoothing | Canvas 2D renderer |
| `pose/keypoints.ts` — keypoint layout | cover-fit projection |
| `catalog/data.ts` — garments, anchors, size charts | |

Only the pose source and the renderer differ. `catalog/data.ts` carries
everything except the artwork reference, because React Native needs `require()`
and the browser needs a URL; each platform attaches its own.

### Fit and finish

Four things do most of the work of making a flat PNG read as worn clothing:

- **Warped onto the torso, not pasted over it.** A rigid transform can only
  translate, rotate and scale a rectangle, which is exactly why an overlay
  reads as a sticker: it cannot narrow at the waist or curve around a body.
  The garment is drawn as a triangle mesh (`src/render/meshWarp.ts`) whose
  destination grid narrows where the torso narrows and bows toward the viewer
  at the centre, because a torso is round.

  The taper comes from the four torso landmarks, deliberately not from the
  segmentation mask: the mask's outline at chest height is the torso *plus*
  both arms, and warping to it makes a t-shirt widen until its sleeves swallow
  the forearms. `src/fit/torsoTaper.ts` in the shared core does the maths and
  bounds it, so a mis-detected hip cannot pinch a garment to nothing.

  The mesh is composited once at full opacity rather than per triangle; blending
  each triangle separately leaves a lattice of seams across the fabric.

- **Clipped to the body.** The pose model also returns a segmentation mask, and
  the garment is drawn to its own layer and then clipped to the wearer's
  silhouette (`src/render/bodyMask.ts`). Without this the garment spills past
  the body onto the background, which is the clearest tell that nothing is
  really being worn. The snapshot clips through the same code, so a saved look
  cannot differ from the preview.
- **Anchored to the shoulder seam, not the joint.** Both pose models put the
  shoulder keypoint at the joint, several centimetres below where a shoulder
  seam sits. Anchoring straight to it hangs every piece low and leaves a bare
  gap at the collar, so `solveFit` lifts by `SHOULDER_LIFT` along the garment's
  own up axis - which keeps it right when the wearer leans.
- **Arms in front.** A garment drawn over the torso otherwise covers a hand
  resting on the chest, which reads as the arm being *inside* the shirt. The
  forearms are cut out of the garment (`src/render/armOcclusion.ts`), and only
  where they lie over the torso quad - an arm at the wearer's side is beside
  the torso, not in front of it, so a long sleeve covering it survives. The
  stroked bone only says *which* part of the body is arm; the segmentation
  mask supplies its actual outline, so the cut follows the limb rather than a
  capsule.

  The idea comes from [ali-m07/mirrorfit](https://github.com/ali-m07/mirrorfit)
  (MIT), which cuts against a stroked polygon; intersecting with the mask is
  this project's addition.

- **Bounded stretch.** `scaleX` and `scaleY` come from shoulder breadth and
  torso length independently, which unbounded turns a tee into a tall narrow
  slab on a long-torsoed wearer. Anisotropy is clamped; past the bound the hem
  sits higher instead, as fabric actually behaves.

### Pose

MediaPipe Pose Landmarker (BlazePose), not the MoveNet the mobile app uses — MoveNet's TFJS weights are not distributed in a form this build can
fetch. MediaPipe emits 33 landmarks; `src/pose/landmarks.ts` maps the 17 the
fitting maths expects, so `solveFit` is untouched.

`POSE_MODEL` in `src/pose/usePoseTracker.ts` selects the weights: `lite`
(5.8MB), `full` (9.4MB, the default) or `heavy` (30MB). Add the variant to
`POSE_MODELS` when syncing assets. The GPU delegate needs WebGL2 and falls back
to CPU automatically.

Flat line art is not detected by any of the three - a white figure with a
hairline outline carries no body signal. Silhouettes, photographs and anything
with real shading detect at the default confidence.

### Snapshots

The problem the mobile app had to work around does not exist here: a `<video>`
element draws straight onto a canvas, so a saved look is the video frame plus
the garment at video resolution, with no screenshot of the page involved.

## Development

```bash
npm run verify   # typecheck + unit tests + production build
npm test         # cover projection and the landmark adapter
npm run build    # production bundle into dist/
```

### Browser smoke test

```bash
node scripts/smoke.mjs
```

Drives the real app in Chromium with a Y4M file standing in for the webcam, so
`getUserMedia`, the WASM runtime, the pose model, the shared fitting maths and
the canvas overlay all run for real against a subject whose joint positions are
known. Screenshots land in `scripts/out/`. `scripts/probe.mjs` runs detection on
a single still at several confidence thresholds, which is the quicker tool when
the question is "is it seeing anyone at all".

Both expect the pre-installed Chromium at `/opt/pw-browsers`; override with
`CHROMIUM_PATH`, and the fake feed with `FAKE_VIDEO`.

## Known limitations

- **2D overlay, not cloth simulation.** Garments are warped onto the torso, so
  they read well from the front and degrade as you turn. `solveFit` refuses
  poses more oblique than `MIN_ASPECT` rather than drawing something wrong.
- **No occlusion.** The garment draws over your arms when they cross your body.
- **Anisotropy is bounded.** A very long torso gets a hem that sits higher
  rather than a vertically stretched garment; see `MAX_ANISOTROPY`.
- **Single person**, and **sizing is an estimate**, not a tailor.
- Garment artwork is generated placeholders, not product photography.
