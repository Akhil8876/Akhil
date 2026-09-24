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
import { solveTriangleAffine, type Affine } from '../src/render/meshWarp';

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

// --- mesh warp -------------------------------------------------------------

function apply(m: Affine, p: { x: number; y: number }) {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

test('the triangle affine carries all three source corners onto the destination', () => {
  const s0 = { x: 0, y: 0 }, s1 = { x: 100, y: 0 }, s2 = { x: 0, y: 50 };
  const d0 = { x: 10, y: 20 }, d1 = { x: 90, y: 35 }, d2 = { x: 25, y: 70 };
  const m = solveTriangleAffine(s0, s1, s2, d0, d1, d2)!;
  for (const [s, d] of [[s0, d0], [s1, d1], [s2, d2]] as const) {
    const got = apply(m, s);
    assert.ok(Math.abs(got.x - d.x) < 1e-9 && Math.abs(got.y - d.y) < 1e-9,
      `${JSON.stringify(s)} -> ${JSON.stringify(got)}, wanted ${JSON.stringify(d)}`);
  }
});

test('an interior point stays interior - the mapping is not just the corners', () => {
  const s0 = { x: 0, y: 0 }, s1 = { x: 10, y: 0 }, s2 = { x: 0, y: 10 };
  const d0 = { x: 0, y: 0 }, d1 = { x: 20, y: 0 }, d2 = { x: 0, y: 5 };
  const m = solveTriangleAffine(s0, s1, s2, d0, d1, d2)!;
  // Centroid maps to centroid under any affine.
  const got = apply(m, { x: 10 / 3, y: 10 / 3 });
  assert.ok(Math.abs(got.x - 20 / 3) < 1e-9, `x=${got.x}`);
  assert.ok(Math.abs(got.y - 5 / 3) < 1e-9, `y=${got.y}`);
});

test('a degenerate triangle is refused rather than dividing by zero', () => {
  const collinear = solveTriangleAffine(
    { x: 0, y: 0 }, { x: 5, y: 5 }, { x: 10, y: 10 },
    { x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 },
  );
  assert.equal(collinear, null);
  const coincident = solveTriangleAffine(
    { x: 3, y: 3 }, { x: 3, y: 3 }, { x: 3, y: 3 },
    { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 },
  );
  assert.equal(coincident, null);
});

test('an identity mapping comes back as the identity', () => {
  const a = { x: 0, y: 0 }, b = { x: 7, y: 0 }, c = { x: 0, y: 9 };
  const m = solveTriangleAffine(a, b, c, a, b, c)!;
  assert.ok(Math.abs(m.a - 1) < 1e-9 && Math.abs(m.d - 1) < 1e-9);
  assert.ok(Math.abs(m.b) < 1e-9 && Math.abs(m.c) < 1e-9);
  assert.ok(Math.abs(m.e) < 1e-9 && Math.abs(m.f) < 1e-9);
});
