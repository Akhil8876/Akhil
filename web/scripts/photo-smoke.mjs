/** Drives the photo path end to end: upload a still, check it gets dressed. */
import { chromium } from 'playwright';
import { chromiumPath, CHROMIUM_ARGS } from './chromium.mjs';
import { createServer } from 'vite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'scripts', 'out');
const PHOTO = process.argv[2];
if (!PHOTO) throw new Error('pass an image path');
mkdirSync(OUT, { recursive: true });

const server = await createServer({ root, server: { port: 5196 } });
await server.listen();
const browser = await chromium.launch({
  executablePath: chromiumPath(),
  args: CHROMIUM_ARGS,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[error] ${m.text()}`); });

await page.goto('http://localhost:5196/', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /turn on camera/i }).waitFor();

// The "use a photo" control is a label wrapping a hidden file input.
await page.locator('input[type=file]').first().setInputFiles(PHOTO);

await page.waitForFunction(
  () => document.querySelector('.pill')?.textContent?.includes('Tracking') ?? false,
  { timeout: 90_000 },
).catch(() => console.log('!! never reached Tracking'));
await page.waitForTimeout(1500);

console.log('status pill :', (await page.locator('.pill').first().textContent())?.trim());
console.log('size shown  :', (await page.locator('.size').textContent().catch(() => null))?.trim() ?? '(none)');
await page.screenshot({ path: path.join(OUT, 'photo-1.png') });

await page.getByRole('option').nth(5).click();
await page.waitForTimeout(900);
await page.screenshot({ path: path.join(OUT, 'photo-2.png') });

for (const l of logs.slice(0, 10)) console.log(l);
await browser.close();
await server.close();
console.log('screenshots in', OUT);
