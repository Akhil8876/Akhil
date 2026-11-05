#!/usr/bin/env python3
"""
Draws the synthetic person the browser tests use, and encodes a Y4M clip of it
for Chrome's fake camera.

Why a drawn figure rather than a photograph: the tests need a subject whose
joint positions are known exactly, and one that can be committed to the repo
without licensing anyone's likeness.

Why it has a face, hair, rounded limbs and hands: BlazePose runs a person
detector before it finds landmarks, and that detector is trained on
photographs. A flat vector figure without those features does not clear its
default confidence - verified by probing lite, full and heavy, which all
scored it below 0.3. With them it detects at the stock 0.5 threshold, so the
tests exercise the app's real settings rather than loosened ones.

  python3 generate_test_subject.py [outdir]

Writes subject.png (still), subject-crossed.png (one arm folded across the
chest, for the occlusion cut-out) and subject.y4m (clip for --use-file-for-
fake-video-capture).
"""
from __future__ import annotations

import math
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

W, H = 640, 480
SKIN = (226, 188, 155)
SKIN_SHADE = (198, 160, 128)
HAIR = (58, 44, 38)
SHIRT = (94, 106, 128)
PANTS = (58, 62, 76)
SHOE = (32, 32, 36)
BACKGROUND = (208, 212, 216)


def _capsule(draw, a, b, width, fill):
    draw.line([a, b], fill=fill, width=width)
    r = width // 2
    for (x, y) in (a, b):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def build(cross: float = 0.0, scale: float = 0.92, cx: int = 320, cy: int = 18) -> Image.Image:
    """`cross` runs 0 (arm at the side) to 1 (hand on the opposite chest)."""
    img = Image.new("RGB", (W, H), BACKGROUND)
    d = ImageDraw.Draw(img)

    head_r = int(34 * scale)
    shoulder = int(72 * scale)
    hip = int(48 * scale)
    torso = int(180 * scale)
    upper_arm = int(100 * scale)
    forearm = int(92 * scale)
    thigh = int(150 * scale)
    shin = int(142 * scale)
    shoulder_y = cy + head_r * 2 + int(22 * scale)

    def P(dx, dy):
        return (cx + dx, shoulder_y + dy)

    ls, rs = P(-shoulder, 0), P(shoulder, 0)
    lh, rh = P(-hip, torso), P(hip, torso)
    lk, rk = P(-hip, torso + thigh), P(hip, torso + thigh)
    la, ra = P(-hip, torso + thigh + shin), P(hip, torso + thigh + shin)
    le, lw = P(-shoulder - int(22 * scale), upper_arm), P(-shoulder - int(34 * scale), upper_arm + forearm)

    # The right arm folds in as `cross` rises.
    re = P(shoulder + int(22 * scale) - int(26 * scale * cross), upper_arm - int(8 * scale * cross))
    down = P(shoulder + int(34 * scale), upper_arm + forearm)
    across = P(-int(34 * scale), int(86 * scale))
    rw = (down[0] + (across[0] - down[0]) * cross, down[1] + (across[1] - down[1]) * cross)

    for hip_p, knee, ankle in ((lh, lk, la), (rh, rk, ra)):
        _capsule(d, hip_p, knee, int(42 * scale), PANTS)
        _capsule(d, knee, ankle, int(34 * scale), PANTS)
        d.ellipse([ankle[0] - int(20 * scale), ankle[1] - int(9 * scale),
                   ankle[0] + int(22 * scale), ankle[1] + int(13 * scale)], fill=SHOE)

    d.polygon([ls, rs, rh, lh], fill=SHIRT)
    _capsule(d, ls, rs, int(30 * scale), SHIRT)
    _capsule(d, lh, rh, int(26 * scale), SHIRT)

    _capsule(d, ls, le, int(36 * scale), SHIRT)
    _capsule(d, le, lw, int(28 * scale), SKIN)
    d.ellipse([lw[0] - int(15 * scale), lw[1] - int(6 * scale),
               lw[0] + int(15 * scale), lw[1] + int(26 * scale)], fill=SKIN)

    # Drawn after the torso, so a folded arm reads as being in front of it.
    _capsule(d, rs, re, int(36 * scale), SHIRT)
    _capsule(d, re, rw, int(28 * scale), SKIN)
    d.ellipse([rw[0] - int(16 * scale), rw[1] - int(10 * scale),
               rw[0] + int(16 * scale), rw[1] + int(22 * scale)], fill=SKIN)

    _capsule(d, P(0, 0), P(0, -int(26 * scale)), int(30 * scale), SKIN_SHADE)
    hx, hy = P(0, -head_r - int(8 * scale))
    d.ellipse([hx - head_r, hy - int(head_r * 1.12), hx + head_r, hy + int(head_r * 1.12)], fill=SKIN)
    d.chord([hx - head_r - 2, hy - int(head_r * 1.20), hx + head_r + 2, hy + int(head_r * 0.55)],
            180, 360, fill=HAIR)
    for side in (-1, 1):
        d.ellipse([hx + side * head_r - int(6 * scale), hy - int(6 * scale),
                   hx + side * head_r + int(6 * scale), hy + int(12 * scale)], fill=SKIN_SHADE)
        ex, ey = hx + side * int(13 * scale), hy - int(4 * scale)
        ew = int(6 * scale)
        d.ellipse([ex - ew, ey - int(ew * 0.7), ex + ew, ey + int(ew * 0.7)], fill=(250, 250, 250))
        d.ellipse([ex - int(ew * 0.42), ey - int(ew * 0.42),
                   ex + int(ew * 0.42), ey + int(ew * 0.42)], fill=(48, 38, 32))
        d.line([(ex - ew, ey - int(9 * scale)), (ex + ew, ey - int(11 * scale))],
               fill=HAIR, width=max(2, int(3 * scale)))
    d.line([(hx, hy - int(2 * scale)), (hx, hy + int(10 * scale))],
           fill=SKIN_SHADE, width=max(2, int(3 * scale)))
    d.arc([hx - int(11 * scale), hy + int(8 * scale), hx + int(11 * scale), hy + int(24 * scale)],
          200, 340, fill=(150, 96, 88), width=max(2, int(3 * scale)))

    # Softens the vector edges; the detector prefers it to hard steps.
    return img.filter(ImageFilter.GaussianBlur(0.6))


def _to_i420(rgb: np.ndarray):
    r, g, b = (rgb[..., i].astype(np.float32) for i in range(3))
    y = 0.299 * r + 0.587 * g + 0.114 * b
    u = -0.168736 * r - 0.331264 * g + 0.5 * b + 128
    v = 0.5 * r - 0.418688 * g - 0.081312 * b + 128
    sub = lambda p: p.reshape(H // 2, 2, W // 2, 2).mean(axis=(1, 3))
    return (np.clip(y, 0, 255).astype(np.uint8),
            np.clip(sub(u), 0, 255).astype(np.uint8),
            np.clip(sub(v), 0, 255).astype(np.uint8))


def write_y4m(path: str, frames: int = 60, cross: float = 0.0) -> None:
    """Y4M written directly - the bundled ffmpeg has no PNG decoder."""
    with open(path, "wb") as f:
        f.write(f"YUV4MPEG2 W{W} H{H} F30:1 Ip A1:1 C420\n".encode())
        for i in range(frames):
            t = i / frames
            img = build(cross=cross, cx=320 + int(8 * math.sin(t * 2 * math.pi)))
            y, u, v = _to_i420(np.asarray(img))
            f.write(b"FRAME\n")
            f.write(y.tobytes()); f.write(u.tobytes()); f.write(v.tobytes())


def main() -> None:
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
    os.makedirs(out, exist_ok=True)
    build().save(os.path.join(out, "subject.png"))
    build(cross=1.0).save(os.path.join(out, "subject-crossed.png"))
    write_y4m(os.path.join(out, "subject.y4m"))
    print(f"wrote subject.png, subject-crossed.png, subject.y4m to {out}")


if __name__ == "__main__":
    main()
