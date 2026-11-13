"""把 bundle 根目录的 AppIcon PNG 加进 Xcode Resources。

iOS 的 App Switcher / 设置列表读取的是 bundle 根目录的 AppIcon60x60@2x/@3x，
而不是 Assets.car。虽然 Xcode 通常会自动从 asset catalog 生成这些散装 png，
但在免签名 archive + TrollStore 场景下经常缺失，导致：
  - 桌面图标正常（读 Assets.car）
  - 多任务卡片空白（读根目录 png）

因此显式把 png 放进 Resources，确保它们一定进包。
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PBX = os.path.join(ROOT, "ios", "MusicFree.xcodeproj", "project.pbxproj")

ICONS = [
    "AppIcon60x60@2x.png",
    "AppIcon60x60@3x.png",
    "AppIcon76x76@2x~ipad.png",
]


def main() -> int:
    with open(PBX, "r", encoding="utf-8") as f:
        text = f.read()

    added = 0
    # 使用固定 GUID 段，避免与已有冲突
    base = 0xA1B2C3D4E5F60718293A0010

    for idx, icon in enumerate(ICONS):
        if icon in text:
            print(f"  skip (already referenced): {icon}")
            continue

        file_ref = "%024X" % (base + idx * 2)
        build_ref = "%024X" % (base + idx * 2 + 1)

        # 1) PBXBuildFile
        build_line = (
            f"\t\t{build_ref} /* {icon} in Resources */ = "
            f"{{isa = PBXBuildFile; fileRef = {file_ref} /* {icon} */; }};\n"
        )
        anchor = re.search(
            r"^\t\t[0-9A-F]{24} /\* SplashScreen\.storyboard in Resources \*/.*\n",
            text,
            re.M,
        )
        if not anchor:
            anchor = re.search(
                r"^\t\t[0-9A-F]{24} /\* Images\.xcassets in Resources \*/.*\n", text, re.M
            )
        if not anchor:
            print("ERROR: no PBXBuildFile anchor")
            return 1
        text = text[: anchor.end()] + build_line + text[anchor.end():]

        # 2) PBXFileReference
        ref_line = (
            f'\t\t{file_ref} /* {icon} */ = {{isa = PBXFileReference; '
            f'lastKnownFileType = image.png; name = "{icon}"; '
            f'path = "MusicFree/{icon}"; sourceTree = "<group>"; }};\n'
        )
        anchor2 = re.search(
            r"^\t\t[0-9A-F]{24} /\* SplashScreen\.storyboard \*/ = \{isa = PBXFileReference;.*\n",
            text,
            re.M,
        )
        if not anchor2:
            print("ERROR: no PBXFileReference anchor")
            return 1
        text = text[: anchor2.end()] + ref_line + text[anchor2.end():]

        # 3) 加进 Resources build phase
        resources = re.search(
            r"(13B07F8E1A680F5B00A75B9A /\* Resources \*/ = \{\s*isa = PBXResourcesBuildPhase;\s*"
            r"buildActionMask = \d+;\s*files = \(\s*)(.*?)(\s*\);)",
            text,
            re.S,
        )
        if not resources:
            print("ERROR: Resources phase not found")
            return 1
        body = resources.group(2)
        new_body = f"\t\t\t\t{build_ref} /* {icon} in Resources */,\n" + body
        text = text[: resources.start(2)] + new_body + text[resources.end(2):]

        added += 1
        print(f"  added: {icon}")

    with open(PBX, "w", encoding="utf-8") as f:
        f.write(text)

    print(f"\ndone, {added} icons added")
    return 0


if __name__ == "__main__":
    sys.exit(main())
