/** Isolates pose detection: runs the model on one still, at several thresholds. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const imgPath = process.argv[2] ?? '/tmp/claude-0/-home-user-Akhil/20ff19e7-e351-5b3d-8595-4012b51f6542/scratchpad/frames/000.png';
const dataUrl = `data:image/png;base64,${readFileSync(imgPath).toString('base64')}`;

const server = await createServer({ root, server: { port: 5198 } });
await server.listen();

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5198/', { waitUntil: 'networkidle' });

const result = await page.evaluate(async ({ dataUrl }) => {
  const mod = await import('/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs');
  const { FilesetResolver, PoseLandmarker } = mod;
  const fileset = await FilesetResolver.forVisionTasks('/wasm');

  const img = new Image();
  img.src = dataUrl;
  await img.decode();

  const out = [];
  for (const threshold of [0.5, 0.3, 0.1]) {
    for (const delegate of ['GPU', 'CPU']) {
      try {
        const lm = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate },
          runningMode: 'IMAGE',
          numPoses: 1,
          minPoseDetectionConfidence: threshold,
          minPosePresenceConfidence: threshold,
          minTrackingConfidence: threshold,
        });
        const res = lm.detect(img);
        const pts = res.landmarks[0];
        out.push({
          threshold, delegate,
          poses: res.landmarks.length,
          leftShoulder: pts ? { x: +pts[11].x.toFixed(3), y: +pts[11].y.toFixed(3), v: +(pts[11].visibility ?? -1).toFixed(2) } : null,
        });
        lm.close();
      } catch (e) {
        out.push({ threshold, delegate, error: String(e).slice(0, 90) });
      }
    }
  }
  return { imageSize: [img.naturalWidth, img.naturalHeight], out };
}, { dataUrl });

console.log('image:', result.imageSize.join('x'));
for (const r of result.out) console.log(JSON.stringify(r));

await browser.close();
await server.close();
