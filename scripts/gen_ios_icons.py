"""Generate a full AppIcon.appiconset from a single source image.

The upstream repo ships an empty AppIcon.appiconset (9 slots, no filenames),
so Xcode produced no Assets.car and iOS showed a blank icon.

Usage: python scripts/gen_ios_icons.py
"""
import json
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src", "assets", "imgs", "logo.png")
OUT_DIR = os.path.join(ROOT, "ios", "MusicFree", "Images.xcassets", "AppIcon.appiconset")

# (idiom, size, scale) -> iOS app icon matrix
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


def main() -> int:
    if not os.path.isfile(SRC):
        print(f"source image missing: {SRC}")
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)

    src = Image.open(SRC).convert("RGBA")
    # Square-canvas: center on transparent background, keep aspect ratio
    side = max(src.size)
    canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    canvas.paste(src, ((side - src.width) // 2, (side - src.height) // 2), src)

    # App icons must be opaque: flatten onto white so iOS does not show black
    flat = Image.new("RGB", (side, side), (255, 255, 255))
    flat.paste(canvas, (0, 0), canvas)

    images = []
    for idiom, size, scale in MATRIX:
        px = int(round(size * scale))
        name = f"icon-{idiom}-{size}x{size}@{scale}x.png"
        flat.resize((px, px), Image.LANCZOS).save(os.path.join(OUT_DIR, name), "PNG")
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
