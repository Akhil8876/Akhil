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

### Pose

MediaPipe Pose Landmarker (BlazePose Lite), not the MoveNet the mobile app
uses — MoveNet's TFJS weights are not distributed in a form this build can
fetch. MediaPipe emits 33 landmarks; `src/pose/landmarks.ts` maps the 17 the
fitting maths expects, so `solveFit` is untouched.

The GPU delegate needs WebGL2 and falls back to CPU automatically.

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
