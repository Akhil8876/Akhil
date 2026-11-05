/**
 * Finds a Chromium for the browser tests.
 *
 * The container ships its own build under PLAYWRIGHT_BROWSERS_PATH, and its
 * revision moves when the image is rebuilt. Hardcoding a path breaks the
 * tests every time that happens, so discover it instead and fall back to
 * whatever Playwright resolves on its own.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root == null || !existsSync(root)) return undefined;

  const builds = readdirSync(root)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .reverse();

  for (const build of builds) {
    for (const dir of ['chrome-linux64', 'chrome-linux']) {
      const candidate = path.join(root, build, dir, 'chrome');
      if (existsSync(candidate)) return candidate;
    }
  }
  // Undefined lets Playwright use its own resolution.
  return undefined;
}

/** Flags shared by every browser test. */
export const CHROMIUM_ARGS = [
  // Software WebGL, so the GPU delegate still has a context in a headless box.
  '--enable-unsafe-swiftshader',
];
