/**
 * End-to-end smoke test in a real browser.
 *
 * Chrome can be handed a Y4M file in place of a webcam, so the whole pipeline
 * runs for real - getUserMedia, the MediaPipe WASM runtime, the pose model,
 * the shared fitting maths and the canvas overlay - with a subject whose joint
 * positions we know. Screenshots land in scripts/out/.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'scripts', 'out');
const VIDEO = process.env.FAKE_VIDEO ?? '/tmp/claude-0/-home-user-Akhil/20ff19e7-e351-5b3d-8595-4012b51f6542/scratchpad/figure2.y4m';

mkdirSync(OUT, { recursive: true });

const server = await createServer({ root, server: { port: 5199 } });
await server.listen();
const url = `http://localhost:5199/`;
console.log('serving', url);

// This container ships its own Chromium; use it rather than downloading one.
const EXECUTABLE = process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: [
    '--use-fake-ui-for-media-stream',      // auto-grant the camera prompt
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${VIDEO}`,
    '--enable-unsafe-swiftshader',          // software WebGL for the GPU delegate
  ],
});

const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText ?? ''}`));
page.on('response', (r) => { if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`); });

await page.goto(url, { waitUntil: 'networkidle' });
await page.screenshot({ path: path.join(OUT, '1-start.png') });

await page.getByRole('button', { name: /turn on camera/i }).click();

// Model load + first frames.
await page.waitForFunction(
  () => document.querySelector('.pill')?.textContent?.includes('Tracking') ?? false,
  { timeout: 60_000 },
).catch(() => console.log('!! never reached Tracking'));

await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(OUT, '2-tryon.png') });

const status = await page.locator('.pill').first().textContent();
const size = await page.locator('.size').textContent().catch(() => null);
console.log('status pill :', status?.trim());
console.log('size shown  :', size?.trim() ?? '(none)');

const probe = await page.evaluate(() => {
  const d = window.__mirrorfit;
  if (!d || !d.fit) return null;
  const KP = { LS: 5, RS: 6, LH: 11, RH: 12 };
  const p = d.pose;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  return {
    shoulderPx: +dist(p[KP.LS], p[KP.RS]).toFixed(1),
    torsoPx: +dist(mid(p[KP.LS], p[KP.RS]), mid(p[KP.LH], p[KP.RH])).toFixed(1),
    scaleX: +d.fit.scaleX.toFixed(4),
    scaleY: +d.fit.scaleY.toFixed(4),
    anisotropy: +(d.fit.scaleY / d.fit.scaleX).toFixed(3),
    rotationDeg: +(d.fit.rotation * 180 / Math.PI).toFixed(1),
    view: [Math.round(d.projection.viewWidth), Math.round(d.projection.viewHeight)],
  };
});
console.log('probe       :', JSON.stringify(probe));

// Skeleton view, to check the projection.
await page.getByRole('button', { name: /skeleton/i }).click();
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(OUT, '3-skeleton.png') });

// A different garment, then a saved look.
await page.getByRole('option').nth(5).click();
await page.waitForTimeout(800);
await page.screenshot({ path: path.join(OUT, '4-outerwear.png') });

const saveBtn = page.getByRole('button', { name: /save this look/i });
console.log('save enabled:', await saveBtn.isEnabled());
await saveBtn.click();
await page.waitForTimeout(2500);
const looks = await page.locator('.looks img').count();
console.log('saved looks :', looks);
await page.screenshot({ path: path.join(OUT, '5-saved.png') });

if (logs.length) {
  console.log('\n--- browser console ---');
  for (const l of logs.slice(0, 25)) console.log(l);
}

await browser.close();
await server.close();
console.log('\nscreenshots in', OUT);
