/**
 * Runs the geometry tests.
 *
 * The fitting maths is plain TypeScript with no React Native imports, so it is
 * bundled to CommonJS and exercised under node:test - no simulator, no Jest.
 *
 * Uses esbuild's JS API and Node's own path handling rather than a shell, so
 * this runs identically on Windows, macOS and Linux.
 */
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsDir = path.join(root, 'tests');
const outDir = path.join(root, '.test-build');

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const entryPoints = readdirSync(testsDir)
  .filter((file) => file.endsWith('.test.ts'))
  .map((file) => path.join(testsDir, file));

if (entryPoints.length === 0) {
  console.error('No test files found in tests/');
  process.exit(1);
}

await build({
  entryPoints,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outdir: outDir,
  logLevel: 'warning',
});

const built = readdirSync(outDir)
  .filter((file) => file.endsWith('.js'))
  .map((file) => path.join(outDir, file));

// Pass explicit paths: shell glob expansion is not available on Windows.
const result = spawnSync(process.execPath, ['--test', ...built], { stdio: 'inherit' });
process.exit(result.status ?? 1);
