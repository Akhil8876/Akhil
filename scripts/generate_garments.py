#!/usr/bin/env python3
"""
Generates the placeholder garment artwork bundled with the app.

Every piece is drawn flat-lay, facing forward, head-up, on a 1024x1024
transparent canvas with the shoulder line at a fixed height. That consistency
is what lets `src/fit/solveFit.ts` place any garment with the same maths -
the per-garment numbers in `src/catalog/garments.ts` are read straight off
the geometry below.

Swap these for real cut-out product photography and only the anchor numbers
in the catalog need to change.
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw, ImageFilter

CANVAS = 1024
SHOULDER_Y = 240          # shoulder seam line, artwork pixels from top
NECK_HALF = 78            # half-width of the neck opening

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "assets", "garments")


def _shade(color: tuple[int, int, int], factor: float) -> tuple[int, int, int]:
    return tuple(max(0, min(255, int(c * factor))) for c in color)  # type: ignore[return-value]


def _body_polygon(shoulder_half: int, hem_y: int, waist_half: int) -> list[tuple[int, int]]:
    """Torso outline from shoulder seam down to hem, slightly waisted."""
    cx = CANVAS // 2
    mid_y = (SHOULDER_Y + hem_y) // 2
    mid_half = (shoulder_half + waist_half) // 2
    return [
        (cx - shoulder_half, SHOULDER_Y),
        (cx - mid_half, mid_y),
        (cx - waist_half, hem_y),
        (cx + waist_half, hem_y),
        (cx + mid_half, mid_y),
        (cx + shoulder_half, SHOULDER_Y),
    ]


def _sleeve_polygon(shoulder_half: int, length: int, taper: int, side: int) -> list[tuple[int, int]]:
    """One sleeve, hanging down and out from the shoulder point."""
    cx = CANVAS // 2
    sx = cx + side * shoulder_half
    drop = int(length * 0.92)
    out = int(length * 0.38)
    return [
        (sx, SHOULDER_Y),
        (sx + side * out, SHOULDER_Y + drop),
        (sx + side * (out - taper), SHOULDER_Y + drop + taper),
        (sx - side * taper, SHOULDER_Y + int(length * 0.20)),
    ]


def draw_garment(
    name: str,
    color: tuple[int, int, int],
    shoulder_half: int,
    hem_y: int,
    waist_half: int,
    sleeve_length: int,
    collar: str = "crew",
    open_front: bool = False,
) -> None:
    img = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    cx = CANVAS // 2

    # Sleeves sit behind the body so the shoulder seam reads cleanly.
    for side in (-1, 1):
        draw.polygon(
            _sleeve_polygon(shoulder_half, sleeve_length, 18, side),
            fill=_shade(color, 0.88),
        )

    draw.polygon(_body_polygon(shoulder_half, hem_y, waist_half), fill=color)

    # Neckline, cut out of the body.
    if collar == "crew":
        draw.ellipse(
            [cx - NECK_HALF, SHOULDER_Y - 42, cx + NECK_HALF, SHOULDER_Y + 46],
            fill=(0, 0, 0, 0),
        )
    elif collar == "v":
        draw.polygon(
            [
                (cx - NECK_HALF, SHOULDER_Y - 20),
                (cx, SHOULDER_Y + 128),
                (cx + NECK_HALF, SHOULDER_Y - 20),
            ],
            fill=(0, 0, 0, 0),
        )

    # Soft interior shading so the flat fill reads as fabric rather than a decal.
    shading = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    sdraw = ImageDraw.Draw(shading)
    sdraw.polygon(
        _body_polygon(shoulder_half - 46, hem_y - 30, waist_half - 46),
        fill=(*_shade(color, 1.16), 90),
    )
    shading = shading.filter(ImageFilter.GaussianBlur(38))
    img = Image.alpha_composite(img, shading)
    draw = ImageDraw.Draw(img)

    if open_front:
        # Centre placket for jackets and coats.
        draw.rectangle(
            [cx - 7, SHOULDER_Y + 40, cx + 7, hem_y],
            fill=_shade(color, 0.72),
        )

    # Hem and cuff lines.
    draw.line(
        [(cx - waist_half + 6, hem_y - 14), (cx + waist_half - 6, hem_y - 14)],
        fill=(*_shade(color, 0.7), 150),
        width=5,
    )

    path = os.path.join(OUT_DIR, f"{name}.png")
    img.save(path)
    print(f"  {name}.png  shoulderWidth={shoulder_half * 2}  torsoLength={hem_y - SHOULDER_Y}")


GARMENTS = [
    # name,                 color,            shoulderHalf, hemY, waistHalf, sleeve, collar, openFront
    ("tee-white",           (242, 242, 238),  232, 700, 216, 190, "crew", False),
    ("tee-navy",            (30,  46,  82),   232, 700, 216, 190, "crew", False),
    ("henley-olive",        (86,  98,  66),   238, 726, 222, 330, "v",    False),
    ("oxford-sky",          (168, 198, 226),  244, 742, 228, 420, "v",    True),
    ("bomber-black",        (34,  34,  38),   276, 700, 268, 430, "crew", True),
    ("trench-camel",        (186, 152, 104),  282, 892, 286, 450, "v",    True),
    ("knit-rust",           (168, 84,  52),   248, 748, 232, 430, "crew", False),
    ("dress-emerald",       (22,  104, 86),   208, 930, 240, 120, "v",    False),
]


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    print(f"Writing {len(GARMENTS)} garments to {os.path.realpath(OUT_DIR)}")
    for name, color, sh, hem, waist, sleeve, collar, open_front in GARMENTS:
        draw_garment(name, color, sh, hem, waist, sleeve, collar, open_front)


if __name__ == "__main__":
    main()
