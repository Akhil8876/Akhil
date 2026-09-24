/**
 * Texture-mapped mesh drawing for Canvas 2D.
 *
 * Canvas can only draw an image under an affine transform, which is why a
 * garment placed with translate/rotate/scale reads as a sticker: an affine
 * cannot taper at the waist or curve around a torso. Subdividing the image
 * into a grid and giving every triangle its own affine can, because the
 * deformation is piecewise.
 *
 * `solveTriangleAffine` is the whole trick and is pure, so it is tested
 * directly in tests/web.test.ts.
 */

export interface Affine {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The unique affine carrying source triangle (s0,s1,s2) onto (d0,d1,d2).
 *
 * Returns null for a degenerate source triangle, which happens at the poles of
 * a mesh and would otherwise divide by zero.
 */
export function solveTriangleAffine(
  s0: Point, s1: Point, s2: Point,
  d0: Point, d1: Point, d2: Point,
): Affine | null {
  const det = (s1.x - s0.x) * (s2.y - s0.y) - (s2.x - s0.x) * (s1.y - s0.y);
  if (Math.abs(det) < 1e-9) return null;

  const a = ((d1.x - d0.x) * (s2.y - s0.y) - (d2.x - d0.x) * (s1.y - s0.y)) / det;
  const c = ((d2.x - d0.x) * (s1.x - s0.x) - (d1.x - d0.x) * (s2.x - s0.x)) / det;
  const b = ((d1.y - d0.y) * (s2.y - s0.y) - (d2.y - d0.y) * (s1.y - s0.y)) / det;
  const d = ((d2.y - d0.y) * (s1.x - s0.x) - (d1.y - d0.y) * (s2.x - s0.x)) / det;

  return { a, b, c, d, e: d0.x - a * s0.x - c * s0.y, f: d0.y - b * s0.x - d * s0.y };
}

/**
 * Nudges a triangle outward from its own centroid.
 *
 * Adjacent clipped triangles otherwise leave a hairline of background between
 * them, which on a garment reads as a crack running down the fabric.
 */
function expand(p: Point, cx: number, cy: number, by: number): Point {
  const dx = p.x - cx;
  const dy = p.y - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return p;
  return { x: p.x + (dx / len) * by, y: p.y + (dy / len) * by };
}

const OVERDRAW_PX = 1.25;

/**
 * Draws `image` deformed by `map`, which sends normalised image coordinates
 * (u, v in [0,1]) to destination points in the current canvas space.
 */
export function drawMesh(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  imageWidth: number,
  imageHeight: number,
  cols: number,
  rows: number,
  map: (u: number, v: number) => Point,
): void {
  // Destination grid, computed once: every interior vertex is shared by six
  // triangles and re-deriving it per triangle would cost six times as much.
  const grid: Point[][] = [];
  for (let r = 0; r <= rows; r++) {
    const row: Point[] = [];
    for (let c = 0; c <= cols; c++) row.push(map(c / cols, r / rows));
    grid.push(row);
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const su0 = (c / cols) * imageWidth;
      const su1 = ((c + 1) / cols) * imageWidth;
      const sv0 = (r / rows) * imageHeight;
      const sv1 = ((r + 1) / rows) * imageHeight;

      const p00 = grid[r]![c]!;
      const p10 = grid[r]![c + 1]!;
      const p01 = grid[r + 1]![c]!;
      const p11 = grid[r + 1]![c + 1]!;

      const quads: [Point, Point, Point, Point, Point, Point][] = [
        [{ x: su0, y: sv0 }, { x: su1, y: sv0 }, { x: su0, y: sv1 }, p00, p10, p01],
        [{ x: su1, y: sv0 }, { x: su1, y: sv1 }, { x: su0, y: sv1 }, p10, p11, p01],
      ];

      for (const [s0, s1, s2, d0, d1, d2] of quads) {
        const m = solveTriangleAffine(s0, s1, s2, d0, d1, d2);
        if (m == null) continue;

        const cx = (d0.x + d1.x + d2.x) / 3;
        const cy = (d0.y + d1.y + d2.y) / 3;
        const e0 = expand(d0, cx, cy, OVERDRAW_PX);
        const e1 = expand(d1, cx, cy, OVERDRAW_PX);
        const e2 = expand(d2, cx, cy, OVERDRAW_PX);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(e0.x, e0.y);
        ctx.lineTo(e1.x, e1.y);
        ctx.lineTo(e2.x, e2.y);
        ctx.closePath();
        ctx.clip();
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
        ctx.drawImage(image, 0, 0, imageWidth, imageHeight);
        ctx.restore();
      }
    }
  }
}
