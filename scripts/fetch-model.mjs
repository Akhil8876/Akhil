/**
 * Fetches the MoveNet SinglePose Lightning pose model.
 *
 * A copy is committed at assets/models/movenet-lightning.tflite so a fresh
 * clone builds without network access. Re-run this only to refresh it.
 *
 * Model contract relied on by src/pose/usePoseDetector.ts:
 *   input  [1, 192, 192, 3] uint8   (RGB)
 *   output [1, 1, 17, 3]    float32 (y, x, score), normalised to the input square
 *
 * Source: google-coral/test_data, Apache License 2.0.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const URL_ =
  'https://raw.githubusercontent.com/google-coral/test_data/master/movenet_single_pose_lightning_ptq.tflite';
const EXPECTED_BYTES = 2894840;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dest = path.join(root, 'assets', 'models', 'movenet-lightning.tflite');

console.log('Fetching MoveNet Lightning...');
const response = await fetch(URL_);
if (!response.ok) {
  console.error(`Download failed: ${response.status} ${response.statusText}`);
  process.exit(1);
}

const bytes = new Uint8Array(await response.arrayBuffer());
if (bytes.byteLength !== EXPECTED_BYTES) {
  console.error(
    `Unexpected model size: got ${bytes.byteLength}B, expected ${EXPECTED_BYTES}B.\n` +
      'Refusing to install. Verify the source before updating EXPECTED_BYTES.',
  );
  process.exit(1);
}

mkdirSync(path.dirname(dest), { recursive: true });
writeFileSync(dest, bytes);
console.log(`Installed ${dest} (${bytes.byteLength} bytes)`);
