"""Add SplashScreen.storyboard to the Xcode project.

expo-splash-screen hardcodes UIStoryboard(name: "SplashScreen") and throws if the
resource is absent, which aborted app launch on iOS 16.1.1. The storyboard must be
compiled into the bundle, so it has to be listed in the Resources build phase.

Idempotent: safe to run multiple times.
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PBX = os.path.join(ROOT, "ios", "MusicFree.xcodeproj", "project.pbxproj")

FILE_REF_ID = "A1B2C3D4E5F60718293A0001"
BUILD_FILE_ID = "A1B2C3D4E5F60718293A0002"


def main() -> int:
    with open(PBX, "r", encoding="utf-8") as f:
        text = f.read()

    if "SplashScreen.storyboard" in text:
        print("SplashScreen.storyboard already referenced, nothing to do")
        return 0

    # 1) PBXBuildFile entry (matches the LaunchScreen one but with our own GUID)
    build_file = (
        f"\t\t{BUILD_FILE_ID} /* SplashScreen.storyboard in Resources */ = "
        f"{{isa = PBXBuildFile; fileRef = {FILE_REF_ID} /* SplashScreen.storyboard */; }};\n"
    )
    anchor = re.search(r'^\t\t[0-9A-F]{24} /\* LaunchScreen\.storyboard in Resources \*/.*\n', text, re.M)
    if not anchor:
        print("could not find LaunchScreen PBXBuildFile anchor")
        return 1
    text = text[:anchor.end()] + build_file + text[anchor.end():]

    # 2) PBXFileReference entry
    file_ref = (
        f'\t\t{FILE_REF_ID} /* SplashScreen.storyboard */ = {{isa = PBXFileReference; '
        f'fileEncoding = 4; lastKnownFileType = file.storyboard; name = SplashScreen.storyboard; '
        f'path = MusicFree/SplashScreen.storyboard; sourceTree = "<group>"; }};\n'
    )
    anchor2 = re.search(r'^\t\t[0-9A-F]{24} /\* LaunchScreen\.storyboard \*/ = \{isa = PBXFileReference;.*\n', text, re.M)
    if not anchor2:
        print("could not find LaunchScreen PBXFileReference anchor")
        return 1
    text = text[:anchor2.end()] + file_ref + text[anchor2.end():]

    # 3) Resources build phase
    resources = re.search(
        r'(13B07F8E1A680F5B00A75B9A /\* Resources \*/ = \{\s*isa = PBXResourcesBuildPhase;\s*'
        r'buildActionMask = \d+;\s*files = \(\s*)(.*?)(\s*\);)',
        text, re.S,
    )
    if not resources:
        print("could not locate the app target Resources build phase")
        return 1
    body = resources.group(2)
    if "Images.xcassets" not in body:
        print("unexpected Resources phase content; aborting to avoid corruption")
        return 1
    new_body = (
        f"\t\t\t\t{BUILD_FILE_ID} /* SplashScreen.storyboard in Resources */,\n" + body
    )
    text = text[:resources.start(2)] + new_body + text[resources.end(2):]

    with open(PBX, "w", encoding="utf-8") as f:
        f.write(text)
    print("added SplashScreen.storyboard to project + Resources phase")
    return 0


if __name__ == "__main__":
    sys.exit(main())
