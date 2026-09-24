/**
 * Where the wearer's arms pass in front of the garment.
 *
 * A garment drawn over the torso covers whatever is in front of it, including
 * a hand resting on the chest or folded arms - which reads as the arm being
 * *inside* the shirt. The fix is to cut the garment away where an arm is
 * genuinely in front of the body.
 *
 * The rule that makes this safe for long sleeves: only the part of the forearm
 * that lies over the TORSO counts. An arm hanging at the wearer's side is
 * beside the torso, not in front of it, so a long sleeve covering that arm is
 * left alone. An arm folded across the chest is inside the torso quad and gets
 * cut. Both cases come out right without knowing anything about the garment.
 *
 * Pure geometry, so the React Native renderer can use it too.
 */
import { KP, MIN_KEYPOINT_SCORE, type Pose } from '../pose/keypoints';
import { distance } from '../utils/math';
import type { Vec2 } from '../utils/math';

export interface Segment {
  from: Vec2;
  to: Vec2;
}

/**
 * The four torso corners, in order: left shoulder, right shoulder, right hip,
 * left hip. Null when the torso is not confidently tracked.
 */
export function torsoQuad(pose: Pose): [Vec2, Vec2, Vec2, Vec2] | null {
  const ls = pose[KP.LeftShoulder];
  const rs = pose[KP.RightShoulder];
  const lh = pose[KP.LeftHip];
  const rh = pose[KP.RightHip];
  if (!ls || !rs || !lh || !rh) return null;
  if (
    ls.score < MIN_KEYPOINT_SCORE ||
    rs.score < MIN_KEYPOINT_SCORE ||
    lh.score < MIN_KEYPOINT_SCORE * 0.7 ||
    rh.score < MIN_KEYPOINT_SCORE * 0.7
  ) {
    return null;
  }
  return [
    { x: ls.x, y: ls.y },
    { x: rs.x, y: rs.y },
    { x: rh.x, y: rh.y },
    { x: lh.x, y: lh.y },
  ];
}

/**
 * Forearm segments, elbow to wrist, for each arm that is confidently seen.
 *
 * Deliberately not the upper arm: that is where a sleeve sits, and a sleeve is
 * supposed to be in front of the arm rather than behind it.
 */
export function forearms(pose: Pose): Segment[] {
  const out: Segment[] = [];
  for (const [elbowIndex, wristIndex] of [
    [KP.LeftElbow, KP.LeftWrist],
    [KP.RightElbow, KP.RightWrist],
  ] as const) {
    const elbow = pose[elbowIndex];
    const wrist = pose[wristIndex];
    if (!elbow || !wrist) continue;
    if (elbow.score < MIN_KEYPOINT_SCORE || wrist.score < MIN_KEYPOINT_SCORE) continue;
    out.push({ from: { x: elbow.x, y: elbow.y }, to: { x: wrist.x, y: wrist.y } });
  }
  return out;
}

/**
 * How wide to draw an arm, from the wearer's own scale rather than a fixed
 * pixel count - otherwise it is right at one distance from the camera only.
 */
export function armThickness(pose: Pose): number {
  const ls = pose[KP.LeftShoulder];
  const rs = pose[KP.RightShoulder];
  if (!ls || !rs) return 0;
  return distance(ls, rs) * ARM_TO_SHOULDER;
}

/** Forearm breadth as a fraction of shoulder breadth. */
const ARM_TO_SHOULDER = 0.19;

/**
 * Extends a forearm past the wrist by a hand's length, so a hand resting on
 * the chest is cut out along with the arm it belongs to.
 */
export function withHand(segment: Segment, thickness: number): Segment {
  const dx = segment.to.x - segment.from.x;
  const dy = segment.to.y - segment.from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return segment;
  const reach = thickness * HAND_REACH;
  return {
    from: segment.from,
    to: { x: segment.to.x + (dx / len) * reach, y: segment.to.y + (dy / len) * reach },
  };
}

/** A hand is roughly this many forearm-widths long. */
const HAND_REACH = 1.1;

/**
 * Whether any forearm is over the torso at all. Lets the renderer skip the
 * whole stencil when nobody's arms are raised, which is most frames.
 */
export function anyForearmOverTorso(pose: Pose): boolean {
  const quad = torsoQuad(pose);
  if (quad == null) return false;
  const thickness = armThickness(pose);
  for (const arm of forearms(pose)) {
    const extended = withHand(arm, thickness);
    if (pointInQuad(extended.to, quad) || pointInQuad(midpoint2(extended), quad)) return true;
  }
  return false;
}

function midpoint2(s: Segment): Vec2 {
  return { x: (s.from.x + s.to.x) / 2, y: (s.from.y + s.to.y) / 2 };
}

/** Standard winding test, valid for the convex-ish quad a torso gives. */
export function pointInQuad(p: Vec2, quad: [Vec2, Vec2, Vec2, Vec2]): boolean {
  let positive = false;
  let negative = false;
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross > 0) positive = true;
    if (cross < 0) negative = true;
    if (positive && negative) return false;
  }
  return true;
}
