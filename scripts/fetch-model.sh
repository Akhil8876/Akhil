#!/usr/bin/env bash
#
# Fetches the MoveNet SinglePose Lightning pose model.
#
# A copy is committed at assets/models/movenet-lightning.tflite so a fresh
# clone builds without network access. Re-run this only to refresh it.
#
# Model contract relied on by src/pose/usePoseDetector.ts:
#   input  [1, 192, 192, 3] uint8   (RGB)
#   output [1, 1, 17, 3]    float32 (y, x, score), normalised to the input square
#
# Source: google-coral/test_data, Apache License 2.0.
set -euo pipefail

URL="https://raw.githubusercontent.com/google-coral/test_data/master/movenet_single_pose_lightning_ptq.tflite"
DEST="$(dirname "$0")/../assets/models/movenet-lightning.tflite"
EXPECTED_BYTES=2894840

echo "Fetching MoveNet Lightning..."
mkdir -p "$(dirname "$DEST")"
curl -fSL --retry 3 --retry-delay 2 -o "$DEST.tmp" "$URL"

SIZE=$(wc -c < "$DEST.tmp" | tr -d ' ')
if [ "$SIZE" -ne "$EXPECTED_BYTES" ]; then
  echo "Unexpected model size: got ${SIZE}B, expected ${EXPECTED_BYTES}B" >&2
  echo "Refusing to install. Verify the source before updating EXPECTED_BYTES." >&2
  rm -f "$DEST.tmp"
  exit 1
fi

mv "$DEST.tmp" "$DEST"
echo "Installed $DEST (${SIZE} bytes)"
