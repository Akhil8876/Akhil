/**
 * Static guard against a bug class that no runtime test can catch.
 *
 * The Babel worklet plugin collects a worklet's free variables from its body
 * and copies them into the closure shipped to the frame-processor runtime. It
 * does not walk default-parameter expressions, so
 *
 *     function f(config: Cfg = DEFAULT_CFG) { 'worklet'; ... }
 *
 * typechecks, bundles, and then throws "Property 'DEFAULT_CFG' doesn't exist"
 * on the first camera frame. Defaults have to be resolved inside the body.
 *
 * This scans the real source rather than the bundle, so it fails at `npm test`
 * instead of on a device twenty minutes into a build.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const SRC = path.join(process.cwd(), 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * A parameter default whose value is an identifier rather than a literal.
 * `= 5` and `= 'x'` are safe - they carry no free variable to capture.
 */
const IDENTIFIER_DEFAULT = /^\s*[A-Za-z_$][\w$]*\??\s*:\s*[^,()=]+=\s*[A-Za-z_$][\w$]*/;

test('no worklet file gives a parameter an identifier default', () => {
  const offenders: string[] = [];

  for (const file of sourceFiles(SRC)) {
    const source = readFileSync(file, 'utf8');
    if (!source.includes("'worklet'")) continue;

    source.split('\n').forEach((line, index) => {
      // Skip anything that is plainly not a parameter list.
      if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return;
      if (IDENTIFIER_DEFAULT.test(line)) {
        offenders.push(`${path.relative(process.cwd(), file)}:${index + 1}  ${line.trim()}`);
      }
    });
  }

  assert.deepEqual(
    offenders,
    [],
    'Worklet parameter defaults must be resolved inside the function body:\n' +
      offenders.join('\n'),
  );
});

test('the guard actually detects the pattern it is meant to catch', () => {
  // Without this, a broken regex would make the test above pass vacuously.
  assert.ok(IDENTIFIER_DEFAULT.test('  config: OneEuroConfig = DEFAULT_ONE_EURO,'));
  assert.ok(IDENTIFIER_DEFAULT.test('  opts: Options = FALLBACK,'));
  // Literals carry nothing to capture, so they are allowed.
  assert.ok(!IDENTIFIER_DEFAULT.test('  count: number = 5,'));
  assert.ok(!IDENTIFIER_DEFAULT.test("  label: string = 'x',"));
});
