/**
 * Copies the runtime assets the app serves from its own origin.
 *
 * The MediaPipe WASM runtime (~34MB) ships inside node_modules and the garment
 * artwork lives at the repo root, shared with the React Native app. Copying
 * both at install time keeps one source of truth for the artwork and keeps the
 * WASM out of git, while still serving everything from this origin so the app
 * works offline and nothing about the wearer leaves the device.
 */
import { cpSync, mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const repoRoot = path.resolve(root, '..');

const jobs = [
  {
    what: 'MediaPipe WASM runtime',
    from: path.join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm'),
    to: path.join(root, 'public', 'wasm'),
  },
  {
    what: 'garment artwork',
    from: path.join(repoRoot, 'assets', 'garments'),
    to: path.join(root, 'public', 'garments'),
  },
];

/**
 * BlazePose weights, from Google's own MediaPipe model bucket. Downloaded
 * rather than committed: 'full' alone is 9.4MB and 'heavy' is 30MB. Change
 * POSE_MODEL in src/pose/usePoseTracker.ts to switch which one the app loads,
 * and add it here.
 */
const MODELS = (process.env.POSE_MODELS ?? 'full').split(',').map((s) => s.trim());
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';

for (const variant of MODELS) {
  const dest = path.join(root, 'public', 'models', `pose_landmarker_${variant}.task`);
  if (existsSync(dest) && statSync(dest).size > 1_000_000) {
    console.log(`pose model '${variant}' already present`);
    continue;
  }
  const url = `${MODEL_BASE}/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`;
  process.stdout.write(`downloading pose model '${variant}'... `);
  const response = await fetch(url);
  if (!response.ok) {
    console.error(`failed: ${response.status} ${response.statusText}\n  ${url}`);
    process.exit(1);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1_000_000) {
    console.error(`failed: got only ${bytes.byteLength} bytes`);
    process.exit(1);
  }
  mkdirSync(path.dirname(dest), { recursive: true });
  writeFileSync(dest, bytes);
  console.log(`${(bytes.byteLength / 1e6).toFixed(1)}MB`);
}

for (const job of jobs) {
  if (!existsSync(job.from)) {
    console.error(`Missing ${job.what} at ${job.from}`);
    process.exit(1);
  }
  mkdirSync(job.to, { recursive: true });
  cpSync(job.from, job.to, { recursive: true });
  console.log(`synced ${job.what} -> ${path.relative(root, job.to)}`);
}
