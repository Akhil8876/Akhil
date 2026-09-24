/**
 * Numerical checks for the geometry that places a garment on a body.
 *
 * Run with: npm test
 *
 * These cover the parts that typechecking cannot: whether a centred subject
 * actually lands in the centre of the preview, whether mirroring flips the
 * axis it should, and whether the fit solver produces the scale it claims.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { projectToView, squareCrop, rotationForOrientation } from '../src/pose/projection';
import { solveFit } from '../src/fit/solveFit';
import { torsoTaperFromPose, taperAt } from '../src/fit/torsoTaper';
import { measureBody, recommendSize } from '../src/fit/measure';
import { createOneEuroState, filterOneEuro } from '../src/utils/oneEuro';
import { KP, KEYPOINT_COUNT, type Pose } from '../src/pose/keypoints';

const VIEW = { width: 400, height: 800 };

function makePose(points: Partial<Record<KP, { x: number; y: number; score?: number }>>): Pose {
  const pose: Pose = [];
  for (let i = 0; i < KEYPOINT_COUNT; i++) {
    const p = points[i as KP];
    pose.push(p ? { x: p.x, y: p.y, score: p.score ?? 0.9 } : { x: 0, y: 0, score: 0 });
  }
  return pose;
}

test('orientation table covers every case', () => {
  assert.equal(rotationForOrientation('portrait'), 0);
  assert.equal(rotationForOrientation('landscape-left'), 90);
  assert.equal(rotationForOrientation('portrait-upside-down'), 180);
  assert.equal(rotationForOrientation('landscape-right'), 270);
});

test('square crop is centred and takes the short side', () => {
  const crop = squareCrop(1280, 720);
  assert.equal(crop.size, 720);
  assert.equal(crop.y, 0);
  assert.equal(crop.x, 280);
});

test('the centre of the model square lands at the centre of the view', () => {
  for (const orientation of ['portrait', 'landscape-left', 'portrait-upside-down', 'landscape-right'] as const) {
    for (const mirrored of [false, true]) {
      const p = projectToView(0.5, 0.5, {
        frameWidth: 1280,
        frameHeight: 720,
        orientation,
        view: VIEW,
        mirrored,
      });
      assert.ok(Math.abs(p.x - VIEW.width / 2) < 1e-6, `x for ${orientation}/${mirrored}`);
      assert.ok(Math.abs(p.y - VIEW.height / 2) < 1e-6, `y for ${orientation}/${mirrored}`);
    }
  }
});

test('mirroring reflects across the vertical centre line only', () => {
  const base = { frameWidth: 720, frameHeight: 720, orientation: 'portrait' as const, view: VIEW };
  const plain = projectToView(0.25, 0.4, { ...base, mirrored: false });
  const flipped = projectToView(0.25, 0.4, { ...base, mirrored: true });
  assert.ok(Math.abs(plain.x + flipped.x - VIEW.width) < 1e-6);
  assert.ok(Math.abs(plain.y - flipped.y) < 1e-6);
});

test('a 90 degree buffer rotation maps the top edge to the correct side', () => {
  const config = {
    frameWidth: 720,
    frameHeight: 720,
    orientation: 'landscape-left' as const,
    view: { width: 720, height: 720 },
    mirrored: false,
  };
  // Rotating clockwise sends the top-left of the buffer to the top-right.
  const p = projectToView(0, 0, config);
  assert.ok(Math.abs(p.x - 720) < 1e-6, `x=${p.x}`);
  assert.ok(Math.abs(p.y - 0) < 1e-6, `y=${p.y}`);
});

const ANCHORS = {
  width: 1024,
  height: 1024,
  shoulderMid: { x: 512, y: 240 },
  shoulderWidth: 464,
  torsoLength: 460,
};

test('a level centred torso solves to zero rotation at the shoulder midpoint', () => {
  // Shoulders 100px, torso 110px - a build inside the anisotropy bounds, so
  // this stays a test of the placement maths rather than of the clamp.
  const pose = makePose({
    [KP.LeftShoulder]: { x: 150, y: 300 },
    [KP.RightShoulder]: { x: 250, y: 300 },
    [KP.LeftHip]: { x: 160, y: 410 },
    [KP.RightHip]: { x: 240, y: 410 },
  });
  const fit = solveFit(pose, ANCHORS, { shoulderEase: 1, lengthEase: 1 });
  assert.ok(fit != null);
  assert.equal(fit.rotation, 0);
  assert.equal(fit.originX, 200);
  // Lifted above the shoulder landmarks, where a shoulder seam actually sits:
  // 12% of the 100px shoulder breadth.
  assert.ok(Math.abs(fit.originY - (300 - 12)) < 1e-9, `originY=${fit.originY}`);
  // shoulders span 100px against 464 artwork px; torso 110px against 460.
  assert.ok(Math.abs(fit.scaleX - 100 / 464) < 1e-9);
  assert.ok(Math.abs(fit.scaleY - 110 / 460) < 1e-9);
  assert.equal(fit.anchorX, 512);
});

test('ease and user trim both scale the garment', () => {
  const pose = makePose({
    [KP.LeftShoulder]: { x: 150, y: 300 },
    [KP.RightShoulder]: { x: 250, y: 300 },
    [KP.LeftHip]: { x: 160, y: 500 },
    [KP.RightHip]: { x: 240, y: 500 },
  });
  const plain = solveFit(pose, ANCHORS, { shoulderEase: 1, lengthEase: 1 })!;
  const eased = solveFit(pose, ANCHORS, {
    shoulderEase: 1.2,
    lengthEase: 1.2,
    userScale: 1.1,
  })!;
  assert.ok(Math.abs(eased.scaleX - plain.scaleX * 1.2 * 1.1) < 1e-9);
  assert.ok(Math.abs(eased.scaleY - plain.scaleY * 1.2 * 1.1) < 1e-9);
});

test('a tilted shoulder line rotates the garment with it', () => {
  const pose = makePose({
    [KP.LeftShoulder]: { x: 150, y: 300 },
    [KP.RightShoulder]: { x: 250, y: 400 },
    [KP.LeftHip]: { x: 160, y: 500 },
    [KP.RightHip]: { x: 240, y: 560 },
  });
  const fit = solveFit(pose, ANCHORS, { shoulderEase: 1, lengthEase: 1 })!;
  assert.ok(Math.abs(fit.rotation - Math.PI / 4) < 1e-9);
});

test('an edge-on torso is rejected rather than squashed', () => {
  const pose = makePose({
    [KP.LeftShoulder]: { x: 198, y: 300 },
    [KP.RightShoulder]: { x: 202, y: 300 },
    [KP.LeftHip]: { x: 198, y: 500 },
    [KP.RightHip]: { x: 202, y: 500 },
  });
  assert.equal(solveFit(pose, ANCHORS, { shoulderEase: 1, lengthEase: 1 }), null);
});

test('low confidence landmarks fade the overlay instead of hiding it', () => {
  const pose = makePose({
    [KP.LeftShoulder]: { x: 150, y: 300, score: 0.9 },
    [KP.RightShoulder]: { x: 250, y: 300, score: 0.9 },
    [KP.LeftHip]: { x: 160, y: 500, score: 0.3 },
    [KP.RightHip]: { x: 240, y: 500, score: 0.9 },
  });
  const fit = solveFit(pose, ANCHORS, { shoulderEase: 1, lengthEase: 1 })!;
  assert.ok(fit.confidence > 0 && fit.confidence < 1, `confidence=${fit.confidence}`);
});

test('full-body framing measures shoulders from the wearer height', () => {
  // 1.75m subject: nose-to-ankle spans 600px, shoulders 130px.
  const pose = makePose({
    [KP.Nose]: { x: 200, y: 100 },
    [KP.LeftShoulder]: { x: 135, y: 180 },
    [KP.RightShoulder]: { x: 265, y: 180 },
    [KP.LeftAnkle]: { x: 180, y: 700 },
    [KP.RightAnkle]: { x: 220, y: 700 },
  });
  const m = measureBody(pose, 175);
  assert.equal(m.quality, 'full-body');
  // 600px visible / 0.87 = 689.7px total; 175cm/689.7px * 130px = 33.0cm
  assert.ok(Math.abs(m.shoulderCm - 33.0) < 0.5, `got ${m.shoulderCm}`);
});

test('half-body framing falls back to the height ratio and says so', () => {
  const pose = makePose({
    [KP.LeftShoulder]: { x: 135, y: 180 },
    [KP.RightShoulder]: { x: 265, y: 180 },
  });
  const m = measureBody(pose, 180);
  assert.equal(m.quality, 'estimated');
  assert.ok(Math.abs(m.shoulderCm - 180 * 0.245) < 1e-9);
});

test('no shoulders means no measurement at all', () => {
  assert.equal(measureBody(makePose({}), 175).quality, 'unavailable');
});

const SIZES = [
  { label: 'S', shoulderCm: [39, 42] as [number, number], chestCm: 94 },
  { label: 'M', shoulderCm: [42, 45] as [number, number], chestCm: 102 },
  { label: 'L', shoulderCm: [45, 48] as [number, number], chestCm: 110 },
];

test('a body inside a band gets that size', () => {
  const rec = recommendSize({ shoulderCm: 43.5, chestCm: 100, quality: 'full-body' }, SIZES);
  assert.equal(rec?.size.label, 'M');
  assert.equal(rec?.match, 'in-range');
});

test('a body outside every band gets the nearest size and a warning', () => {
  const rec = recommendSize({ shoulderCm: 53, chestCm: 122, quality: 'full-body' }, SIZES);
  assert.equal(rec?.size.label, 'L');
  assert.equal(rec?.match, 'closest');
  assert.match(rec!.note, /snug/);
});

test('one euro filter settles on a constant signal', () => {
  const state = createOneEuroState();
  let out = 0;
  for (let i = 0; i < 60; i++) out = filterOneEuro(state, 100, i * 33.3);
  assert.ok(Math.abs(out - 100) < 0.5, `settled at ${out}`);
});

test('one euro filter survives a duplicated timestamp', () => {
  const state = createOneEuroState();
  filterOneEuro(state, 10, 1000);
  const out = filterOneEuro(state, 20, 1000);
  assert.ok(Number.isFinite(out), `got ${out}`);
});

test('an unmirrored frame does not hang the garment upside down', () => {
  // MoveNet labels shoulders anatomically, so on an unmirrored frame the
  // wearer's left shoulder sits to the RIGHT of their right shoulder. Naive
  // right-minus-left gives ~180 degrees here.
  const pose = makePose({
    [KP.LeftShoulder]: { x: 250, y: 300 },
    [KP.RightShoulder]: { x: 150, y: 300 },
    [KP.LeftHip]: { x: 240, y: 500 },
    [KP.RightHip]: { x: 160, y: 500 },
  });
  const fit = solveFit(pose, ANCHORS, { shoulderEase: 1, lengthEase: 1 })!;
  assert.ok(Math.abs(fit.rotation) < 1e-9, `rotation=${fit.rotation}`);
});

test('the garment always hangs toward the hips', () => {
  // Whatever the labelling, the artwork's +y axis must point at the hips.
  for (const swapped of [false, true]) {
    const pose = makePose({
      [KP.LeftShoulder]: { x: swapped ? 250 : 150, y: 300 },
      [KP.RightShoulder]: { x: swapped ? 150 : 250, y: 300 },
      [KP.LeftHip]: { x: swapped ? 240 : 160, y: 520 },
      [KP.RightHip]: { x: swapped ? 160 : 240, y: 520 },
    });
    const fit = solveFit(pose, ANCHORS, { shoulderEase: 1, lengthEase: 1 })!;
    const downY = Math.cos(fit.rotation);
    assert.ok(downY > 0, `swapped=${swapped}: garment points up, rotation=${fit.rotation}`);
  }
});

test('rotation stays in the canonical (-pi, pi] range', () => {
  const pose = makePose({
    [KP.LeftShoulder]: { x: 250, y: 300 },
    [KP.RightShoulder]: { x: 150, y: 300 },
    [KP.LeftHip]: { x: 240, y: 500 },
    [KP.RightHip]: { x: 160, y: 500 },
  });
  const fit = solveFit(pose, ANCHORS, { shoulderEase: 1, lengthEase: 1 })!;
  assert.ok(fit.rotation > -Math.PI && fit.rotation <= Math.PI, `rotation=${fit.rotation}`);
});

test('a long torso does not stretch the garment into a rectangle', () => {
  // Shoulders 100px, torso 280px: the shape that measured 1.84 anisotropy in
  // the browser and rendered the tee as a tall narrow slab.
  const pose = makePose({
    [KP.LeftShoulder]: { x: 150, y: 300 },
    [KP.RightShoulder]: { x: 250, y: 300 },
    [KP.LeftHip]: { x: 160, y: 580 },
    [KP.RightHip]: { x: 240, y: 580 },
  });
  const fit = solveFit(pose, ANCHORS, { shoulderEase: 1.06, lengthEase: 1.32 })!;
  const anisotropy = fit.scaleY / fit.scaleX;
  assert.ok(anisotropy <= 1.18 + 1e-9, `anisotropy=${anisotropy}`);
  // Still scaled to the body, not collapsed to something arbitrary.
  assert.ok(Math.abs(fit.scaleX - (100 * 1.06) / ANCHORS.shoulderWidth) < 1e-9);
});

test('a short torso does not squash the garment either', () => {
  const pose = makePose({
    [KP.LeftShoulder]: { x: 100, y: 300 },
    [KP.RightShoulder]: { x: 300, y: 300 },
    [KP.LeftHip]: { x: 140, y: 360 },
    [KP.RightHip]: { x: 260, y: 360 },
  });
  const fit = solveFit(pose, ANCHORS, { shoulderEase: 1, lengthEase: 1 })!;
  const anisotropy = fit.scaleY / fit.scaleX;
  assert.ok(anisotropy >= 0.85 - 1e-9, `anisotropy=${anisotropy}`);
});

test('a normal build is left untouched by the anisotropy bounds', () => {
  const pose = makePose({
    [KP.LeftShoulder]: { x: 150, y: 300 },
    [KP.RightShoulder]: { x: 250, y: 300 },
    [KP.LeftHip]: { x: 160, y: 410 },
    [KP.RightHip]: { x: 240, y: 410 },
  });
  const fit = solveFit(pose, ANCHORS, { shoulderEase: 1, lengthEase: 1 })!;
  assert.ok(Math.abs(fit.scaleY - (110 * 1) / ANCHORS.torsoLength) < 1e-9, 'scaleY was clamped');
});

test('the shoulder lift follows the wearer when they lean', () => {
  // Shoulder line tilted 90 degrees: "up" for the garment is now -x, so the
  // lift must move along x, not y. A lift hard-coded to screen-up would put
  // the garment beside the wearer instead of above the shoulder line.
  const pose = makePose({
    [KP.LeftShoulder]: { x: 200, y: 250 },
    [KP.RightShoulder]: { x: 200, y: 350 },
    [KP.LeftHip]: { x: 320, y: 260 },
    [KP.RightHip]: { x: 320, y: 340 },
  });
  const fit = solveFit(pose, ANCHORS, { shoulderEase: 1, lengthEase: 1 })!;
  const shoulderMid = { x: 200, y: 300 };
  const lift = 100 * 0.12;
  // Hips are at +x, so the garment hangs toward +x and lifts toward -x.
  assert.ok(Math.abs(fit.originX - (shoulderMid.x - lift)) < 1e-6, `originX=${fit.originX}`);
  assert.ok(Math.abs(fit.originY - shoulderMid.y) < 1e-6, `originY=${fit.originY}`);
});

test('the lift scales with the wearer, not the screen', () => {
  const near = solveFit(makePose({
    [KP.LeftShoulder]: { x: 100, y: 300 },
    [KP.RightShoulder]: { x: 300, y: 300 },
    [KP.LeftHip]: { x: 120, y: 520 },
    [KP.RightHip]: { x: 280, y: 520 },
  }), ANCHORS, { shoulderEase: 1, lengthEase: 1 })!;
  const far = solveFit(makePose({
    [KP.LeftShoulder]: { x: 175, y: 300 },
    [KP.RightShoulder]: { x: 225, y: 300 },
    [KP.LeftHip]: { x: 180, y: 355 },
    [KP.RightHip]: { x: 220, y: 355 },
  }), ANCHORS, { shoulderEase: 1, lengthEase: 1 })!;
  assert.ok(Math.abs((300 - near.originY) - 200 * 0.12) < 1e-9);
  assert.ok(Math.abs((300 - far.originY) - 50 * 0.12) < 1e-9);
});

test('torso taper is measured from the landmarks', () => {
  const pose = makePose({
    [KP.LeftShoulder]: { x: 150, y: 300 },
    [KP.RightShoulder]: { x: 250, y: 300 },   // 100px across
    [KP.LeftHip]: { x: 170, y: 500 },
    [KP.RightHip]: { x: 230, y: 500 },        // 60px across, 200px down
  });
  const taper = torsoTaperFromPose(pose)!;
  assert.equal(taper.shoulderHalf, 50);
  assert.equal(taper.hipHalf, 30);
  assert.equal(taper.torsoLength, 200);

  assert.ok(Math.abs(taperAt(taper, 0) - 1) < 1e-9, 'shoulder line is unchanged');
  assert.ok(Math.abs(taperAt(taper, 200) - 0.6) < 1e-9, 'hip line matches the body');
  assert.ok(Math.abs(taperAt(taper, 100) - 0.8) < 1e-9, 'halfway is halfway');
});

test('below the hips the garment hangs straight instead of tapering to a point', () => {
  const pose = makePose({
    [KP.LeftShoulder]: { x: 150, y: 300 },
    [KP.RightShoulder]: { x: 250, y: 300 },
    [KP.LeftHip]: { x: 170, y: 500 },
    [KP.RightHip]: { x: 230, y: 500 },
  });
  const taper = torsoTaperFromPose(pose)!;
  assert.equal(taperAt(taper, 400), taperAt(taper, 200));
});

test('an implausible waist is bounded rather than followed', () => {
  const collapsed = torsoTaperFromPose(makePose({
    [KP.LeftShoulder]: { x: 150, y: 300 },
    [KP.RightShoulder]: { x: 250, y: 300 },
    [KP.LeftHip]: { x: 199, y: 500 },
    [KP.RightHip]: { x: 201, y: 500 },   // a 2px waist
  }))!;
  assert.ok(taperAt(collapsed, 200) >= 0.6 - 1e-9, 'garment must not pinch to nothing');

  const flared = torsoTaperFromPose(makePose({
    [KP.LeftShoulder]: { x: 180, y: 300 },
    [KP.RightShoulder]: { x: 220, y: 300 },
    [KP.LeftHip]: { x: 100, y: 500 },
    [KP.RightHip]: { x: 300, y: 500 },
  }))!;
  assert.ok(taperAt(flared, 200) <= 1.25 + 1e-9, 'garment must not balloon');
});
