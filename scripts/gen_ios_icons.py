"""Generate a full-bleed AppIcon.appiconset from a single source image.

Why this exists
---------------
The upstream repo ships an EMPTY AppIcon.appiconset (9 slots, no filenames),
so Xcode emitted no usable icon and iOS showed a blank tile.

Icon rules that matter here
---------------------------
* iOS app icons must be fully OPAQUE. Any alpha is ignored and can render as a
  black plate, so every output is converted to RGB.
* The system applies the rounded-corner mask itself. Do NOT bake in rounded
  corners or a visible frame: after masking, any inner margin reads as a
  "white/odd border" around the artwork.
* Therefore the artwork is scaled to FULL BLEED (100% of the canvas), not
  inset. The mark is allowed to be cropped slightly at the extreme edges,
  which is what real app icons do.

Usage: python scripts/gen_ios_icons.py
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "assets", "imgs", "logo.png")
OUT_DIR = os.path.join(ROOT, "ios", "MusicFree", "Images.xcassets", "AppIcon.appiconset")

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

FALLBACK_BG = (39, 40, 44)

# 1.0 = artwork touches every edge (true full bleed, like stock iOS icons).
# Slight overscan hides antialiasing seams after the rounded mask is applied.
BLEED = 1.00


def dominant_color(img: Image.Image):
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
    """Opaque 1024x1024 master whose artwork bleeds to all four edges."""
    rgba = src.convert("RGBA")
    bg = dominant_color(rgba)

    bbox = rgba.getbbox()
    if bbox:
        rgba = rgba.crop(bbox)

    # The logo is a bright cat mark on a dark plate. Keep only the bright mark,
    # so the icon is "white cat on solid brand background" at full bleed.
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
        art = rgba.crop((x0, y0, x1 + 1, y1 + 1))
    else:
        art = rgba

    # Full bleed: scale the mark so it covers the whole canvas.
    target = int(1024 * BLEED)
    scale = target / float(max(art.width, art.height))
    art = art.resize(
        (max(1, int(round(art.width * scale))), max(1, int(round(art.height * scale)))),
        Image.LANCZOS,
    )

    layer = Image.new("RGB", art.size, bg)
    layer.paste(art, (0, 0), art)

    # Center; with BLEED > 1 the overflow is cropped by the canvas bounds.
    off = ((1024 - layer.width) // 2, (1024 - layer.height) // 2)
    canvas.paste(layer, off)
    return canvas


def main() -> int:
    if not os.path.isfile(SRC):
        print(f"source image missing: {SRC}")
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)

    src = Image.open(SRC)
    master = build_master(src)
    print(f"master 1024x1024 opaque full-bleed, bg={dominant_color(src.convert('RGBA'))}")

    images = []
    for idiom, size, scale in MATRIX:
        px = int(round(size * scale))
        name = f"icon-{idiom}-{size}x{size}@{scale}x.png"
        master.resize((px, px), Image.LANCZOS).convert("RGB").save(
            os.path.join(OUT_DIR, name), "PNG"
        )
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
