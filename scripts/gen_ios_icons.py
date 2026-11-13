"""Generate a full AppIcon.appiconset from a single source image.

The upstream repo ships an empty AppIcon.appiconset (9 slots, no filenames),
so Xcode produced no Assets.car and iOS showed a blank icon.

Design rules for iOS app icons:
  * must be fully opaque (alpha is ignored/blackened by iOS)
  * must be a full-bleed square; the system applies the rounded mask itself
  * do NOT bake in rounded corners or leave padding, otherwise you get the
    "white border" look after SpringBoard masks it

The source logo.png is 192x192 with ~30% transparent margin, so pasting it on
a white canvas produced a white frame. Instead we fill the canvas with the
brand background colour sampled from the logo itself and scale the mark to
~86% so it reads well inside the rounded mask.

Usage: python scripts/gen_ios_icons.py
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "assets", "imgs", "logo.png")
OUT_DIR = os.path.join(ROOT, "ios", "MusicFree", "Images.xcassets", "AppIcon.appiconset")

# (idiom, size, scale)
MATRIX = [
    ("iphone", 20, 2), ("iphone", 20, 3),
    ("iphone", 29, 2), ("iphone", 29, 3),
    ("iphone", 40, 2), ("iphone", 40, 3),
    ("iphone", 60, 2), ("iphone", 60, 3),
    ("ipad", 20, 1), ("ipad", 20, 2),
    ("ipad", 29, 1), ("ipad", 29, 2),
    ("ipad", 40, 1), ("ipad", 40, 2),
    ("ipad", 76, 1), ("ipad", 76, 2),
    ("ipad", 83.5, 2),
    ("ios-marketing", 1024, 1),
]

# Fallback background if the logo has no usable opaque colour.
FALLBACK_BG = (39, 40, 44)
MARK_RATIO = 0.94  # how much of the canvas the artwork occupies


def dominant_color(img: Image.Image):
    """Most common opaque colour, used as the icon background."""
    rgb = img.convert("RGBA")
    small = rgb.resize((64, 64), Image.NEAREST)
    counts = {}
    for r, g, b, a in small.getdata():
        if a < 200:
            continue
        counts[(r, g, b)] = counts.get((r, g, b), 0) + 1
    if not counts:
        return FALLBACK_BG
    return max(counts.items(), key=lambda kv: kv[1])[0]


def build_master(src: Image.Image) -> Image.Image:
    """Square, fully opaque master image at 1024x1024."""
    rgba = src.convert("RGBA")
    bg = dominant_color(rgba)

    # The source logo is a white cat mark sitting on a dark rounded square,
    # surrounded by a transparent margin. If we crop to alpha bbox we keep the
    # dark plate, and the cat ends up tiny in the middle of the icon.
    # Instead: isolate the bright artwork (the cat) and re-composite it onto a
    # full-bleed background, so the mark fills the icon properly.
    bbox = rgba.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)

    w, h = rgba.size
    px = rgba.load()
    bright = []
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 200 and r > 170 and g > 170 and b > 170:
                bright.append((x, y))

    canvas = Image.new("RGB", (1024, 1024), bg)

    if bright:
        x0 = min(p[0] for p in bright)
        x1 = max(p[0] for p in bright)
        y0 = min(p[1] for p in bright)
        y1 = max(p[1] for p in bright)
        # Small padding so the mark does not touch the rounded mask edge.
        pad = max(2, int(0.02 * max(x1 - x0, y1 - y0)))
        box = (max(0, x0 - pad), max(0, y0 - pad),
               min(w, x1 + pad + 1), min(h, y1 + pad + 1))
        art = rgba.crop(box)
    else:
        art = rgba

    inner = int(1024 * MARK_RATIO)
    # NOTE: Image.thumbnail() only ever SHRINKS an image; our cropped mark is
    # ~110px, so thumbnail() would leave it tiny in the middle of the icon.
    # Compute an explicit scale so the mark actually fills the canvas.
    scale = inner / float(max(art.width, art.height))
    new_size = (max(1, int(round(art.width * scale))),
                max(1, int(round(art.height * scale))))
    art = art.resize(new_size, Image.LANCZOS)

    # Alpha-blend the mark onto the solid background => stays fully opaque
    layer = Image.new("RGB", art.size, bg)
    layer.paste(art, (0, 0), art)

    off = ((1024 - art.width) // 2, (1024 - art.height) // 2)
    canvas.paste(layer, off)
    return canvas


def main() -> int:
    if not os.path.isfile(SRC):
        print(f"source image missing: {SRC}")
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)

    src = Image.open(SRC)
    master = build_master(src)
    print(f"master 1024x1024 opaque, bg={dominant_color(src.convert('RGBA'))}")

    images = []
    for idiom, size, scale in MATRIX:
        px = int(round(size * scale))
        name = f"icon-{idiom}-{size}x{size}@{scale}x.png"
        out = master.resize((px, px), Image.LANCZOS)
        # Guarantee RGB (no alpha) so iOS never renders a black plate.
        out.convert("RGB").save(os.path.join(OUT_DIR, name), "PNG")
        images.append({
            "filename": name,
            "idiom": idiom,
            "scale": f"{scale}x",
            "size": f"{size}x{size}",
        })
        print(f"  {name:44s} {px}x{px}")

    contents = {"images": images, "info": {"author": "xcode", "version": 1}}
    with open(os.path.join(OUT_DIR, "Contents.json"), "w", encoding="utf-8") as f:
        json.dump(contents, f, indent=2)
        f.write("\n")

    print(f"\ngenerated {len(images)} icons in {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
