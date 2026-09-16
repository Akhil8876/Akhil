/**
 * Regenerates the placeholder garment artwork.
 *
 * Thin wrapper over the Python generator that finds the interpreter under the
 * name it actually has: `python3` on macOS and Linux, usually `python` on
 * Windows.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(root, 'scripts', 'generate_garments.py');

for (const interpreter of ['python3', 'python']) {
  const result = spawnSync(interpreter, [script], { stdio: 'inherit', shell: false });
  if (result.error == null) {
    process.exit(result.status ?? 0);
  }
}

console.error('Could not find a Python interpreter. Install Python 3 with Pillow:');
console.error('  pip install pillow');
process.exit(1);
