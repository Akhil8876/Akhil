/** Compares pose models on one or more stills: does it detect, and how sure. */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const images = process.argv.slice(2);
if (images.length === 0) throw new Error('pass one or more image paths');

const payload = images.map((p) => ({
  name: path.basename(p),
  dataUrl: `data:image/png;base64,${readFileSync(p).toString('base64')}`,
}));

const server = await createServer({ root, server: { port: 5197 } });
await server.listen();
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--enable-unsafe-swiftshader'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:5197/', { waitUntil: 'networkidle' });

const rows = await page.evaluate(async (payload) => {
  const { FilesetResolver, PoseLandmarker } = await import(
    '/node_modules/@mediapipe/tasks-vision/vision_bundle.mjs'
  );
  const fileset = await FilesetResolver.forVisionTasks('/wasm');
  const models = ['lite', 'full', 'heavy'];
  const out = [];

  for (const model of models) {
    const lm = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: `/models/pose_landmarker_${model}.task`,
        delegate: 'GPU',
      },
      runningMode: 'IMAGE',
      numPoses: 1,
      outputSegmentationMasks: true,
    });
    for (const { name, dataUrl } of payload) {
      const img = new Image();
      img.src = dataUrl;
      await img.decode();
      const res = lm.detect(img);
      const pts = res.landmarks[0];
      const vis = (i) => (pts ? +(pts[i].visibility ?? -1).toFixed(2) : null);
      out.push({
        model,
        image: name,
        detected: !!pts,
        shoulders: vis(11), hips: vis(23), ankles: vis(27),
        hasMask: (res.segmentationMasks?.length ?? 0) > 0,
      });
    }
    lm.close();
  }
  return out;
}, payload);

console.log(['model', 'image', 'det', 'shldr', 'hip', 'ankle', 'mask'].join('\t'));
for (const r of rows) {
  console.log([r.model, r.image.replace('stock_', '').replace('.png', ''),
    r.detected ? 'Y' : 'N', r.shoulders, r.hips, r.ankles, r.hasMask ? 'Y' : 'N'].join('\t'));
}

await browser.close();
await server.close();
