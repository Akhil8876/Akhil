/**
 * Checks for the snapshot compositor's geometry.
 *
 * The transform chains in `src/capture/geometry.ts` are data, so they can be
 * replayed here through a plain 2x3 affine matrix written independently of the
 * Skia code that consumes them. That makes these real checks on the maths
 * rather than a restatement of it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  computeOutputSize,
  coverSourceRect,
  garmentTransform,
  photoTransform,
  resolvePhotoOrientation,
  uprightPhotoSize,
  type CanvasOp,
} from '../src/capture/geometry';
import type { FrameOrientation } from '../src/pose/projection';

/** Affine matrix [a c e; b d f], column-vector convention. */
interface M {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

const IDENTITY: M = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(m: M, n: M): M {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

/** Matches Skia: positive degrees rotate clockwise on a y-down canvas. */
function opMatrix(op: CanvasOp): M {
  switch (op.op) {
    case 'translate':
      return { a: 1, b: 0, c: 0, d: 1, e: op.x, f: op.y };
    case 'scale':
      return { a: op.x, b: 0, c: 0, d: op.y, e: 0, f: 0 };
    case 'rotate': {
      const r = (op.degrees * Math.PI) / 180;
      return { a: Math.cos(r), b: Math.sin(r), c: -Math.sin(r), d: Math.cos(r), e: 0, f: 0 };
    }
  }
}

function replay(ops: CanvasOp[]): M {
  return ops.reduce((acc, op) => multiply(acc, opMatrix(op)), IDENTITY);
}

function apply(m: M, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

const ORIENTATIONS: FrameOrientation[] = [
  'portrait',
  'landscape-left',
  'portrait-upside-down',
  'landscape-right',
];

function near(actual: number, expected: number, tolerance = 1e-6): boolean {
  return Math.abs(actual - expected) < tolerance;
}

test('upright size swaps axes on a quarter turn only', () => {
  assert.deepEqual(uprightPhotoSize(1920, 1080, 'portrait'), {
    width: 1920, height: 1080, rotation: 0,
  });
  assert.deepEqual(uprightPhotoSize(1920, 1080, 'portrait-upside-down'), {
    width: 1920, height: 1080, rotation: 180,
  });
  assert.deepEqual(uprightPhotoSize(1920, 1080, 'landscape-left'), {
    width: 1080, height: 1920, rotation: 90,
  });
  assert.deepEqual(uprightPhotoSize(1920, 1080, 'landscape-right'), {
    width: 1080, height: 1920, rotation: 270,
  });
});

test('cover trims the sides of a source wider than the destination', () => {
  const r = coverSourceRect(2000, 1000, 500, 500);
  assert.equal(r.height, 1000);
  assert.equal(r.width, 1000);
  assert.equal(r.x, 500);
  assert.equal(r.y, 0);
});

test('cover trims the top and bottom of a taller source', () => {
  const r = coverSourceRect(1000, 2000, 500, 500);
  assert.equal(r.width, 1000);
  assert.equal(r.height, 1000);
  assert.equal(r.x, 0);
  assert.equal(r.y, 500);
});

test('cover on a matching aspect takes the whole source', () => {
  const r = coverSourceRect(1080, 1920, 540, 960);
  assert.deepEqual(r, { x: 0, y: 0, width: 1080, height: 1920 });
});

test('cover survives degenerate input instead of returning NaN', () => {
  const r = coverSourceRect(0, 0, 100, 100);
  assert.ok(Number.isFinite(r.width) && Number.isFinite(r.height));
});

test('output keeps the preview aspect and is capped', () => {
  const view = { width: 390, height: 844 };
  const out = computeOutputSize(view, 8000, 2048);
  assert.equal(out.width, 2048);
  assert.ok(near(out.height / out.width, view.height / view.width, 1e-3));
  assert.ok(near(out.scale, 2048 / 390));
});

test('output never drops below the preview resolution', () => {
  const view = { width: 390, height: 844 };
  const out = computeOutputSize(view, 100, 2048);
  assert.equal(out.width, 390);
  assert.equal(out.scale, 1);
});

test('output of a zero-sized preview is rejected rather than guessed', () => {
  assert.deepEqual(computeOutputSize({ width: 0, height: 0 }, 1000, 2048), {
    width: 0, height: 0, scale: 0,
  });
});

test('the centre of the photo lands at the centre of the snapshot', () => {
  const output = { width: 1080, height: 1920 };
  for (const orientation of ORIENTATIONS) {
    for (const mirror of [false, true]) {
      // Deliberately a landscape buffer, the awkward case.
      const m = replay(
        photoTransform({
          photoWidth: 1920,
          photoHeight: 1080,
          orientation,
          mirror,
          output,
        }),
      );
      const centre = apply(m, 1920 / 2, 1080 / 2);
      assert.ok(
        near(centre.x, output.width / 2, 1e-6),
        `x for ${orientation}/mirror=${mirror}: ${centre.x}`,
      );
      assert.ok(
        near(centre.y, output.height / 2, 1e-6),
        `y for ${orientation}/mirror=${mirror}: ${centre.y}`,
      );
    }
  }
});

test('the photo covers the snapshot with no blank edges', () => {
  const output = { width: 1080, height: 1920 };
  for (const orientation of ORIENTATIONS) {
    const m = replay(
      photoTransform({
        photoWidth: 1920, photoHeight: 1080, orientation, mirror: false, output,
      }),
    );
    const corners = [
      apply(m, 0, 0),
      apply(m, 1920, 0),
      apply(m, 0, 1080),
      apply(m, 1920, 1080),
    ];
    const minX = Math.min(...corners.map((c) => c.x));
    const maxX = Math.max(...corners.map((c) => c.x));
    const minY = Math.min(...corners.map((c) => c.y));
    const maxY = Math.max(...corners.map((c) => c.y));

    assert.ok(minX <= 1e-6 && minY <= 1e-6, `${orientation} leaves a gap at the origin`);
    assert.ok(
      maxX >= output.width - 1e-6 && maxY >= output.height - 1e-6,
      `${orientation} leaves a gap at the far edge`,
    );
  }
});

test('the photo is not distorted - the transform stays uniform', () => {
  for (const orientation of ORIENTATIONS) {
    const m = replay(
      photoTransform({
        photoWidth: 1920,
        photoHeight: 1080,
        orientation,
        mirror: false,
        output: { width: 1080, height: 1920 },
      }),
    );
    // Column lengths equal => scale is the same on both axes.
    const sx = Math.hypot(m.a, m.b);
    const sy = Math.hypot(m.c, m.d);
    assert.ok(near(sx, sy, 1e-6), `${orientation}: ${sx} vs ${sy}`);
  }
});

test('mirroring reflects the snapshot horizontally, not vertically', () => {
  const output = { width: 1080, height: 1920 };
  const base = {
    photoWidth: 1080, photoHeight: 1920, orientation: 'portrait' as const, output,
  };
  const plain = apply(replay(photoTransform({ ...base, mirror: false })), 200, 600);
  const flipped = apply(replay(photoTransform({ ...base, mirror: true })), 200, 600);

  assert.ok(near(plain.x + flipped.x, output.width));
  assert.ok(near(plain.y, flipped.y));
});

test('a quarter-turned buffer is rotated, not just stretched', () => {
  // A landscape buffer shown upright: the buffer's own top-left corner should
  // no longer be at the top-left of the snapshot.
  const m = replay(
    photoTransform({
      photoWidth: 1920,
      photoHeight: 1080,
      orientation: 'landscape-left',
      mirror: false,
      output: { width: 1080, height: 1920 },
    }),
  );
  // Clockwise rotation sends the buffer's top edge to the snapshot's right.
  const topLeft = apply(m, 0, 0);
  const topRight = apply(m, 1920, 0);
  assert.ok(topLeft.y < topRight.y, `top edge did not rotate: ${topLeft.y} vs ${topRight.y}`);
  assert.ok(near(topLeft.x, topRight.x), 'top edge should become vertical');
});

test('the garment anchor lands on the wearer, scaled into the snapshot', () => {
  const fit = {
    originX: 200, originY: 300, rotation: 0,
    scaleX: 0.25, scaleY: 0.4, anchorX: 512, anchorY: 240,
  };
  const scale = 2.5;
  const m = replay(garmentTransform(fit, scale));

  // The artwork's anchor point must land on the solved origin, in output px.
  const anchor = apply(m, fit.anchorX, fit.anchorY);
  assert.ok(near(anchor.x, fit.originX * scale), `x=${anchor.x}`);
  assert.ok(near(anchor.y, fit.originY * scale), `y=${anchor.y}`);
});

test('garment rotation follows the shoulder line into the snapshot', () => {
  const fit = {
    originX: 100, originY: 100, rotation: Math.PI / 2,
    scaleX: 1, scaleY: 1, anchorX: 0, anchorY: 0,
  };
  const m = replay(garmentTransform(fit, 1));
  // A quarter turn clockwise sends +x to +y.
  const p = apply(m, 10, 0);
  assert.ok(near(p.x, 100, 1e-9), `x=${p.x}`);
  assert.ok(near(p.y, 110, 1e-9), `y=${p.y}`);
});

test('garment scale compounds the view-to-output scale', () => {
  const fit = {
    originX: 0, originY: 0, rotation: 0,
    scaleX: 0.5, scaleY: 0.5, anchorX: 0, anchorY: 0,
  };
  const m = replay(garmentTransform(fit, 4));
  const p = apply(m, 100, 100);
  assert.ok(near(p.x, 200) && near(p.y, 200), `${p.x},${p.y}`);
});

test('a decoder that already applied EXIF is not rotated twice', () => {
  // Camera says landscape-left (1920x1080), decoder handed back 1080x1920.
  assert.equal(
    resolvePhotoOrientation(1920, 1080, 1080, 1920, 'landscape-left'),
    'portrait',
  );
});

test('a decoder that left the buffer alone keeps the declared orientation', () => {
  assert.equal(
    resolvePhotoOrientation(1920, 1080, 1920, 1080, 'landscape-left'),
    'landscape-left',
  );
});

test('half turns are left alone - the aspect cannot reveal them', () => {
  assert.equal(
    resolvePhotoOrientation(1920, 1080, 1920, 1080, 'portrait-upside-down'),
    'portrait-upside-down',
  );
  assert.equal(resolvePhotoOrientation(1080, 1920, 1080, 1920, 'portrait'), 'portrait');
});

test('a square photo trusts the camera rather than guessing', () => {
  // A square is transposed either way, so the aspect reveals nothing. The
  // declared rotation still has to be applied or the content comes out sideways.
  assert.equal(
    resolvePhotoOrientation(1000, 1000, 1000, 1000, 'landscape-left'),
    'landscape-left',
  );
});
