export interface Vec2 {
  x: number;
  y: number;
}

export function midpoint(a: Vec2, b: Vec2): Vec2 {
  'worklet';
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function distance(a: Vec2, b: Vec2): number {
  'worklet';
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export function clamp(value: number, min: number, max: number): number {
  'worklet';
  return value < min ? min : value > max ? max : value;
}

export function lerp(a: number, b: number, t: number): number {
  'worklet';
  return a + (b - a) * t;
}
