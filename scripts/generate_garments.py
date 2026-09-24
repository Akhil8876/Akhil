#!/usr/bin/env python3
"""
Generates the garment artwork bundled with both apps.

Every piece is drawn flat-lay, facing forward, head-up, on a 1024x1024
transparent canvas with the shoulder seam at a fixed height, so one set of
fitting maths places any of them (see src/fit/solveFit.ts).

Realism comes from three things rather than detail:
  * a smooth pattern outline - shoulder slope, armhole scye, waist taper -
    built from Catmull-Rom splines instead of straight polygon edges;
  * cylindrical shading, because a torso is round, so the fabric darkens
    toward both side seams and picks up a soft highlight off-centre;
  * supersampling, so every edge is anti-aliased rather than stepped.

Swap these for real cut-out product photography and only the three anchor
numbers per garment in src/catalog/data.ts need to change.
"""
from __future__ import annotations

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

CANVAS = 1024
SHOULDER_Y = 240          # shoulder seam, artwork pixels from top
SS = 3                    # supersampling factor
OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "garments")


# ---------------------------------------------------------------- geometry

def catmull_rom(points: list[tuple[float, float]], samples: int = 18) -> list[tuple[float, float]]:
    """Smooth curve through the given control points."""
    if len(points) < 3:
        return points
    pts = [points[0]] + points + [points[-1]]
    out: list[tuple[float, float]] = []
    for i in range(len(pts) - 3):
        p0, p1, p2, p3 = pts[i], pts[i + 1], pts[i + 2], pts[i + 3]
        for s in range(samples):
            t = s / samples
            t2, t3 = t * t, t * t * t
            out.append((
                0.5 * ((2*p1[0]) + (-p0[0]+p2[0])*t + (2*p0[0]-5*p1[0]+4*p2[0]-p3[0])*t2 + (-p0[0]+3*p1[0]-3*p2[0]+p3[0])*t3),
                0.5 * ((2*p1[1]) + (-p0[1]+p2[1])*t + (2*p0[1]-5*p1[1]+4*p2[1]-p3[1])*t2 + (-p0[1]+3*p1[1]-3*p2[1]+p3[1])*t3),
            ))
    out.append(points[-1])
    return out


def body_outline(shoulder_half, chest_half, waist_half, hem_half, hem_y, neck_half, shoulder_drop):
    """Half a torso pattern, mirrored - collar, shoulder, scye, side seam, hem."""
    cx = CANVAS / 2
    right = catmull_rom([
        (cx + neck_half, SHOULDER_Y - 6),
        (cx + shoulder_half * 0.62, SHOULDER_Y - 2),
        (cx + shoulder_half, SHOULDER_Y + shoulder_drop),
        (cx + chest_half, SHOULDER_Y + (hem_y - SHOULDER_Y) * 0.30),
        (cx + waist_half, SHOULDER_Y + (hem_y - SHOULDER_Y) * 0.66),
        (cx + hem_half, hem_y),
    ])
    left = [(2 * cx - x, y) for x, y in reversed(right)]
    return right + [(cx + hem_half, hem_y), (cx - hem_half, hem_y)] + left


def sleeve_outline(shoulder_half, drop, length, cuff_half, cap_half, side):
    """One sleeve: cap at the shoulder point, tapering to the cuff."""
    cx = CANVAS / 2
    sx = cx + side * shoulder_half
    sy = SHOULDER_Y + drop
    ex = sx + side * length * 0.42
    ey = sy + length * 0.90
    outer = catmull_rom([
        (sx, sy - 4),
        (sx + side * cap_half * 0.9, sy + length * 0.18),
        (ex + side * cuff_half, ey),
    ])
    inner = catmull_rom([
        (ex - side * cuff_half, ey + cuff_half * 0.5),
        (sx + side * cap_half * 0.30, sy + length * 0.46),
        (cx + side * (shoulder_half - cap_half * 0.55), sy + length * 0.10),
    ])
    return outer + inner


# ---------------------------------------------------------------- shading

def shade(mask: Image.Image, color: tuple[int, int, int]) -> Image.Image:
    """Turns a coverage mask into shaded fabric."""
    a = np.asarray(mask, dtype=np.float32) / 255.0
    h, w = a.shape
    base = np.array(color, dtype=np.float32)

    # Cylindrical falloff measured across each row's own extent, so sleeves
    # and body both round off about their own centre lines.
    xs = np.arange(w, dtype=np.float32)[None, :]
    cover = a > 0.5
    first = np.where(cover.any(1), cover.argmax(1), 0)[:, None].astype(np.float32)
    last = np.where(cover.any(1), w - 1 - cover[:, ::-1].argmax(1), 0)[:, None].astype(np.float32)
    span = np.maximum(last - first, 1.0)
    u = np.clip((xs - first) / span, 0, 1)                 # 0..1 across the row
    # Clamp before the fractional power: rows with no coverage give u outside
    # [0,1], and a negative base would come back NaN.
    round_ = np.clip(np.cos((u - 0.5) * np.pi), 0.0, 1.0) ** 0.65
    light = 0.80 + 0.30 * round_
    light += 0.10 * np.exp(-(((u - 0.38) / 0.16) ** 2))    # off-centre highlight

    # Vertical: a little darker toward the hem where fabric gathers.
    v = (np.arange(h, dtype=np.float32) / h)[:, None]
    light *= 1.04 - 0.16 * v

    # Soft vertical folds, deterministic so the artwork is reproducible.
    rng = np.random.default_rng(7)
    folds = np.zeros((1, w), dtype=np.float32)
    for centre in rng.uniform(0.15, 0.85, 5):
        folds += 0.05 * np.exp(-(((xs / w - centre) / 0.035) ** 2))
    light *= 1.0 - folds

    rgb = np.clip(base[None, None, :] * light[:, :, None], 0, 255).astype(np.uint8)
    out = np.dstack([rgb, (a * 255).astype(np.uint8)])
    return Image.fromarray(out, "RGBA")


def draw_shape(points, size) -> Image.Image:
    """Renders a polygon into a supersampled coverage mask."""
    m = Image.new("L", (size * SS, size * SS), 0)
    ImageDraw.Draw(m).polygon([(x * SS, y * SS) for x, y in points], fill=255)
    return m.resize((size, size), Image.LANCZOS)


# ---------------------------------------------------------------- garments

def build(name, color, *, shoulder_half, chest_half, waist_half, hem_half, hem_y,
          sleeve_length, cuff_half=None, cap_half=None, neck_half=76,
          shoulder_drop=26, collar="crew", open_front=False):
    cuff_half = cuff_half or int(sleeve_length * 0.19 + 26)
    cap_half = cap_half or int(sleeve_length * 0.26 + 34)

    sleeves = Image.new("L", (CANVAS, CANVAS), 0)
    for side in (-1, 1):
        s = draw_shape(sleeve_outline(shoulder_half, shoulder_drop, sleeve_length,
                                      cuff_half, cap_half, side), CANVAS)
        sleeves = Image.fromarray(np.maximum(np.asarray(sleeves), np.asarray(s)))

    body = draw_shape(body_outline(shoulder_half, chest_half, waist_half, hem_half,
                                   hem_y, neck_half, shoulder_drop), CANVAS)

    img = Image.alpha_composite(shade(sleeves, tuple(int(c * 0.90) for c in color)),
                                shade(body, color))

    d = ImageDraw.Draw(img)
    cx = CANVAS // 2

    # Neckline, cut back out of the fabric.
    hole = Image.new("L", (CANVAS, CANVAS), 0)
    hd = ImageDraw.Draw(hole)
    if collar == "v":
        hd.polygon([(cx - neck_half, SHOULDER_Y - 14), (cx, SHOULDER_Y + 132),
                    (cx + neck_half, SHOULDER_Y - 14)], fill=255)
    else:
        hd.ellipse([cx - neck_half, SHOULDER_Y - 46, cx + neck_half, SHOULDER_Y + 52], fill=255)
    hole = hole.filter(ImageFilter.GaussianBlur(1.2))
    alpha = np.asarray(img.getchannel("A"), np.float32) * (1 - np.asarray(hole, np.float32) / 255)
    img.putalpha(Image.fromarray(alpha.astype(np.uint8)))

    if collar == "crew":  # ribbed collar band
        d.arc([cx - neck_half - 9, SHOULDER_Y - 55, cx + neck_half + 9, SHOULDER_Y + 61],
              0, 180, fill=(*[int(c * 0.78) for c in color], 235), width=11)
    if open_front:        # centre placket with a shadowed edge
        d.rectangle([cx - 4, SHOULDER_Y + 40, cx + 4, hem_y - 6],
                    fill=(*[int(c * 0.62) for c in color], 255))
        d.line([(cx + 7, SHOULDER_Y + 40), (cx + 7, hem_y - 6)],
               fill=(*[int(c * 1.12) if c * 1.12 < 255 else 255 for c in color], 120), width=3)

    # Hem and cuff stitching.
    d.line([(cx - hem_half + 12, hem_y - 16), (cx + hem_half - 12, hem_y - 16)],
           fill=(*[int(c * 0.72) for c in color], 130), width=4)

    img.save(os.path.join(OUT_DIR, f"{name}.png"))
    print(f"  {name:<16} shoulderWidth={shoulder_half*2:<5} torsoLength={hem_y - SHOULDER_Y}")


GARMENTS = [
    dict(name="tee-white",     color=(243, 243, 239), shoulder_half=232, chest_half=228, waist_half=214, hem_half=216, hem_y=760, sleeve_length=196),
    dict(name="tee-navy",      color=(34, 50, 86),    shoulder_half=232, chest_half=228, waist_half=214, hem_half=216, hem_y=760, sleeve_length=196),
    dict(name="henley-olive",  color=(90, 102, 70),   shoulder_half=238, chest_half=234, waist_half=220, hem_half=222, hem_y=784, sleeve_length=360, collar="v"),
    dict(name="oxford-sky",    color=(170, 200, 228), shoulder_half=244, chest_half=240, waist_half=222, hem_half=228, hem_y=800, sleeve_length=430, collar="v", open_front=True),
    dict(name="knit-rust",     color=(172, 88, 56),   shoulder_half=248, chest_half=246, waist_half=234, hem_half=236, hem_y=792, sleeve_length=430),
    dict(name="bomber-black",  color=(38, 38, 42),    shoulder_half=272, chest_half=268, waist_half=256, hem_half=252, hem_y=744, sleeve_length=440, open_front=True),
    dict(name="trench-camel",  color=(190, 156, 108), shoulder_half=278, chest_half=274, waist_half=262, hem_half=282, hem_y=936, sleeve_length=452, collar="v", open_front=True),
    dict(name="dress-emerald", color=(26, 108, 90),   shoulder_half=210, chest_half=206, waist_half=192, hem_half=250, hem_y=956, sleeve_length=132, collar="v"),
]


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"Writing {len(GARMENTS)} garments to {os.path.realpath(OUT_DIR)}")
    for spec in GARMENTS:
        build(**spec)


if __name__ == "__main__":
    main()
