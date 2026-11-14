"""
用用户指定的图片重做：
  1) 全套 iOS AppIcon（桌面图标 + 多任务卡片，标准命名，全出血无白边）
  2) App 内 logo：src/assets/imgs/logo.png 和 logo-transparent.png

图片特性（实测）：400x400 RGBA，四角透明，黑底主图，主色 (0,0,0)。
处理：透明区域统一填纯黑 (0,0,0)，然后整体拉伸铺满 1024 画布，
      RGB 无 alpha 输出 —— iOS 不会再出现白边。
"""
import io
import json
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = r"C:\Users\Alone\Desktop\deepseek_svg_20261114_bf2b3f.png"
ICON_DIR = os.path.join(ROOT, "ios", "MusicFree", "Images.xcassets", "AppIcon.appiconset")
ASSET_DIR = os.path.join(ROOT, "src", "assets", "imgs")

# (idiom, size, scale) —— Apple 官方 AppIcon 模板
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

BG = (0, 0, 0)  # 与图片主色一致，透明角填黑


def build_master(src_path):
    src = Image.open(src_path).convert("RGBA")
    w, h = src.size
    # 透明像素填黑，得到不透明底图
    flat = Image.new("RGB", (w, h), BG)
    flat.paste(src, (0, 0), src)
    # 全出血拉伸到 1024（不做留白，避免白边）
    master = flat.resize((1024, 1024), Image.LANCZOS)
    return master


def standard_name(size, scale):
    s = f"{size:g}"
    return f"AppIcon{s}x{s}@{scale}x.png"


def main():
    if not os.path.isfile(SRC):
        print("source missing:", SRC)
        return 1
    os.makedirs(ICON_DIR, exist_ok=True)
    os.makedirs(ASSET_DIR, exist_ok=True)

    master = build_master(SRC)
    print("master 1024x1024 RGB, bg=black, full-bleed")

    # 清理旧的非标准命名文件
    for f in os.listdir(ICON_DIR):
        if f.startswith("icon-") and f.endswith(".png"):
            os.remove(os.path.join(ICON_DIR, f))
            print("  removed legacy:", f)

    images = []
    for idiom, size, scale in MATRIX:
        px = int(round(size * scale))
        name = standard_name(size, scale)
        master.resize((px, px), Image.LANCZOS).convert("RGB").save(
            os.path.join(ICON_DIR, name), "PNG"
        )
        images.append({
            "filename": name,
            "idiom": idiom,
            "scale": f"{scale}x",
            "size": f"{size:g}x{size:g}",
        })
        print(f"  {name:34s} {px}x{px}")
    with open(os.path.join(ICON_DIR, "Contents.json"), "w", encoding="utf-8") as f:
        json.dump({"images": images, "info": {"author": "xcode", "version": 1}}, f, indent=2)
        f.write("\n")

    # pbxproj 里直接引用的 3 个散装图标也同步替换
    for name, px in [("AppIcon60x60@2x.png", 120), ("AppIcon60x60@3x.png", 180),
                     ("AppIcon76x76@2x~ipad.png", 152)]:
        p = os.path.join(ROOT, "ios", "MusicFree", name)
        if os.path.isfile(p):
            master.resize((px, px), Image.LANCZOS).convert("RGB").save(p, "PNG")
            print("  updated loose icon:", name)

    # App 内 logo（卡片图片）
    logo = Image.open(SRC).convert("RGBA")
    flat = Image.new("RGB", logo.size, BG)
    flat.paste(logo, (0, 0), logo)
    flat.save(os.path.join(ASSET_DIR, "logo.png"), "PNG")
    # transparent 版本保留原样透明度（供需要透明背景处使用）
    logo.save(os.path.join(ASSET_DIR, "logo-transparent.png"), "PNG")
    print("  updated: src/assets/imgs/logo.png + logo-transparent.png")

    print(f"\ngenerated {len(images)} icons + logo from {SRC}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
