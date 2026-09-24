/**
 * Copies the runtime assets the app serves from its own origin.
 *
 * The MediaPipe WASM runtime (~34MB) ships inside node_modules and the garment
 * artwork lives at the repo root, shared with the React Native app. Copying
 * both at install time keeps one source of truth for the artwork and keeps the
 * WASM out of git, while still serving everything from this origin so the app
 * works offline and nothing about the wearer leaves the device.
 */
import { cpSync, mkdirSync, existsSync } from 'node:fs';
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

for (const job of jobs) {
  if (!existsSync(job.from)) {
    console.error(`Missing ${job.what} at ${job.from}`);
    process.exit(1);
  }
  mkdirSync(job.to, { recursive: true });
  cpSync(job.from, job.to, { recursive: true });
  console.log(`synced ${job.what} -> ${path.relative(root, job.to)}`);
}
