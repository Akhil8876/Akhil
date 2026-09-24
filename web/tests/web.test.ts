/**
 * Unit tests for the web-only layers: the cover projection and the MediaPipe
 * landmark adapter. The fitting maths, sizing and smoothing are shared with
 * the React Native app and tested there.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { coverTransform, projectToView, type ViewProjection } from '../src/pose/project';
import { toPose } from '../src/pose/landmarks';
import { KP } from '@shared/pose/keypoints';

const LANDSCAPE: ViewProjection = {
  videoWidth: 1280, videoHeight: 720,
  viewWidth: 900, viewHeight: 800,
  mirrored: false,
};

function near(a: number, b: number, tol = 1e-6) {
  return Math.abs(a - b) < tol;
}

test('cover scales by the larger ratio and centres the overflow', () => {
  const t = coverTransform(LANDSCAPE);
  // 900/1280 = 0.703, 800/720 = 1.111 -> the taller ratio wins.
  assert.ok(near(t.scale, 800 / 720));
  assert.ok(t.offsetX < 0, 'a wide video should overflow horizontally');
  assert.ok(near(t.offsetY, 0));
});

test('cover survives a video that has not loaded yet', () => {
  const t = coverTransform({ ...LANDSCAPE, videoWidth: 0, videoHeight: 0 });
  assert.ok(Number.isFinite(t.scale) && Number.isFinite(t.offsetX));
});

test('the centre of the frame lands at the centre of the view', () => {
  for (const mirrored of [false, true]) {
    for (const video of [[1280, 720], [720, 1280], [640, 480]] as const) {
      const p: ViewProjection = {
        ...LANDSCAPE, videoWidth: video[0], videoHeight: video[1], mirrored,
      };
      const c = projectToView(0.5, 0.5, p);
      assert.ok(near(c.x, p.viewWidth / 2), `x ${video} mirrored=${mirrored}: ${c.x}`);
      assert.ok(near(c.y, p.viewHeight / 2), `y ${video} mirrored=${mirrored}: ${c.y}`);
    }
  }
});

test('mirroring reflects horizontally only', () => {
  const plain = projectToView(0.3, 0.4, LANDSCAPE);
  const flipped = projectToView(0.3, 0.4, { ...LANDSCAPE, mirrored: true });
  assert.ok(near(plain.x + flipped.x, LANDSCAPE.viewWidth));
  assert.ok(near(plain.y, flipped.y));
});

test('the frame covers the view with no blank edges', () => {
  const p = LANDSCAPE;
  const tl = projectToView(0, 0, p);
  const br = projectToView(1, 1, p);
  assert.ok(tl.x <= 1e-6 && tl.y <= 1e-6, `top-left leaves a gap: ${tl.x},${tl.y}`);
  assert.ok(br.x >= p.viewWidth - 1e-6 && br.y >= p.viewHeight - 1e-6, 'bottom-right leaves a gap');
});

test('MediaPipe landmarks map onto the app keypoint layout', () => {
  // 33 landmarks, each tagged with its own index so the mapping is visible.
  const landmarks = Array.from({ length: 33 }, (_, i) => ({
    x: i / 100, y: 1 - i / 100, visibility: 0.9,
  }));
  const pose = toPose(landmarks);

  assert.equal(pose.length, 17);
  // BlazePose 11/12 are the shoulders, 23/24 the hips.
  assert.ok(near(pose[KP.LeftShoulder]!.x, 0.11));
  assert.ok(near(pose[KP.RightShoulder]!.x, 0.12));
  assert.ok(near(pose[KP.LeftHip]!.x, 0.23));
  assert.ok(near(pose[KP.RightHip]!.x, 0.24));
  assert.ok(near(pose[KP.Nose]!.x, 0));
  assert.equal(pose[KP.LeftShoulder]!.score, 0.9);
});

test('a missing landmark becomes a zero-confidence keypoint, not a crash', () => {
  const pose = toPose([]);
  assert.equal(pose.length, 17);
  assert.ok(pose.every((kp) => kp.score === 0));
});

test('a landmark without visibility is treated as seen', () => {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5 }));
  assert.equal(toPose(landmarks)[KP.LeftShoulder]!.score, 1);
});
