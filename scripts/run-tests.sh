#!/usr/bin/env bash
#
# Runs the geometry tests.
#
# The fitting maths is plain TypeScript with no React Native imports, so it can
# be bundled to CommonJS and exercised under node:test - no simulator, no Jest,
# and fast enough to run on every save.
set -euo pipefail

cd "$(dirname "$0")/.."
OUT=".test-build"
rm -rf "$OUT"

node_modules/.bin/esbuild tests/*.test.ts \
  --bundle \
  --platform=node \
  --format=cjs \
  --target=node22 \
  --outdir="$OUT" \
  --log-level=warning

node --test "$OUT"/*.test.js
