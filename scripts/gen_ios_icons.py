"""Generate a full AppIcon.appiconset with STANDARD iOS filenames.

关键修正
--------
之前用 `icon-iphone-60x60@3x.png` 这类文件名，导致 Xcode 把**文件名**注册成
Assets.car 里的资产名（实测 Assets.car 里出现的是 icon-iphone-60x60@3x.png），
而 Info.plist 的 CFBundleIconName / CFBundleIconFiles 指向的是 `AppIcon` /
`AppIcon60x60`，两边对不上 → 桌面图标能显示（系统 fallback），
但**多任务卡片读不到图标**。

标准做法（Apple 官方模板）是：
    AppIcon20x20@2x.png
    AppIcon20x20@3x.png
    AppIcon29x29@2x.png
    ...
    AppIcon60x60@2x.png
    AppIcon60x60@3x.png
    AppIcon1024x1024@1x.png
这样 Assets.car 里注册的就是 AppIcon 这一组，CFBundleIconName=AppIcon 才能索引到。

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

FALLBACK_BG = (39, 40, 44)
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
    rgba = src.convert("RGBA")
    bg = dominant_color(rgba)

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
        art = rgba.crop((x0, y0, x1 + 1, y1 + 1))
    else:
        art = rgba

    target = int(1024 * BLEED)
    scale = target / float(max(art.width, art.height))
    art = art.resize(
        (max(1, int(round(art.width * scale))), max(1, int(round(art.height * scale)))),
        Image.LANCZOS,
    )

    layer = Image.new("RGB", art.size, bg)
    layer.paste(art, (0, 0), art)

    off = ((1024 - layer.width) // 2, (1024 - layer.height) // 2)
    canvas.paste(layer, off)
    return canvas


def standard_name(size: float, scale: int) -> str:
    """生成 Apple 标准命名，如 AppIcon60x60@2x.png"""
    size_str = f"{size:g}"  # 83.5 -> "83.5", 60 -> "60"
    return f"AppIcon{size_str}x{size_str}@{scale}x.png"


def main() -> int:
    if not os.path.isfile(SRC):
        print(f"source image missing: {SRC}")
        return 1
    os.makedirs(OUT_DIR, exist_ok=True)

    # 清理旧的非标准文件
    for f in os.listdir(OUT_DIR):
        if f.startswith("icon-") and f.endswith(".png"):
            os.remove(os.path.join(OUT_DIR, f))
            print(f"  removed old: {f}")

    src = Image.open(SRC)
    master = build_master(src)
    print(f"master 1024x1024 opaque, bg={dominant_color(src.convert('RGBA'))}")

    images = []
    for idiom, size, scale in MATRIX:
        px = int(round(size * scale))
        name = standard_name(size, scale)
        master.resize((px, px), Image.LANCZOS).convert("RGB").save(
            os.path.join(OUT_DIR, name), "PNG"
        )
        images.append({
            "filename": name,
            "idiom": idiom,
            "scale": f"{scale}x",
            "size": f"{size:g}x{size:g}",
        })
        print(f"  {name:32s} {px}x{px}")

    contents = {"images": images, "info": {"author": "xcode", "version": 1}}
    with open(os.path.join(OUT_DIR, "Contents.json"), "w", encoding="utf-8") as f:
        json.dump(contents, f, indent=2)
        f.write("\n")

    print(f"\ngenerated {len(images)} icons (standard naming) in {OUT_DIR}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
