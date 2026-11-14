"""CarPlay 方案 F 静态校验"""
import io
import os
import plistlib
import re
import subprocess
import sys
from collections import Counter

ROOT = r"C:\Users\Alone\Downloads\Telegram Desktop\MusicFree-iOS"
ok = True


def chk(name, cond, detail=""):
    global ok
    mark = "OK " if cond else "NG "
    safe = detail.encode("ascii", "replace").decode("ascii")
    print(f"  [{mark}] {name} {safe}")
    if not cond:
        ok = False


# 1) Info.plist：两个 role 都显式 delegateClass
info = os.path.join(ROOT, "ios", "MusicFree", "Info.plist")
try:
    pl = plistlib.load(open(info, "rb"))
    chk("Info.plist 可解析", True)
except Exception as e:
    pl = {}
    chk("Info.plist 可解析", False, str(e))

sm = pl.get("UIApplicationSceneManifest")
chk("SceneManifest 存在(方案F)", isinstance(sm, dict))
cfgs = (sm or {}).get("UISceneConfigurations", {})
chk("SupportsMultipleScenes=NO", (sm or {}).get("UIApplicationSupportsMultipleScenes") is False)
win = cfgs.get("UIWindowSceneSessionRoleApplication", [{}])
chk("主场景 delegateClass=AppDelegate", win and win[0].get("UISceneDelegateClassName") == "AppDelegate")
chk("主场景无 StoryboardFile", win and "UISceneStoryboardFile" not in win[0])
car = cfgs.get("CPTemplateApplicationSceneSessionRoleApplication", [{}])
chk("CarPlay delegateClass=MFCarPlaySceneDelegate",
    car and car[0].get("UISceneDelegateClassName") == "MFCarPlaySceneDelegate")
chk("UILaunchScreen 保留", isinstance(pl.get("UILaunchScreen"), dict))
chk("UIBackgroundModes 含 audio", "audio" in (pl.get("UIBackgroundModes") or []))

# 2) entitlements
ent = os.path.join(ROOT, "scripts", "trollstore.entitlements.plist")
try:
    e = plistlib.load(open(ent, "rb"))
    chk("entitlements 可解析", True)
    chk("carplay-audio=true", e.get("com.apple.developer.carplay-audio") is True)
    chk("application-identifier 正确", e.get("application-identifier") == "app.musicfree.ios")
except Exception as ex:
    chk("entitlements 可解析", False, str(ex))

# 3) 源文件
h = io.open(os.path.join(ROOT, "ios", "MusicFree", "CarPlaySceneDelegate.h"), encoding="utf-8").read()
m = io.open(os.path.join(ROOT, "ios", "MusicFree", "CarPlaySceneDelegate.m"), encoding="utf-8").read()
a = io.open(os.path.join(ROOT, "ios", "MusicFree", "AppDelegate.mm"), encoding="utf-8").read()
chk("CarPlaySceneDelegate 声明", "CPTemplateApplicationSceneDelegate" in h)
chk("CarPlaySceneDelegate didConnect", "didConnectInterfaceController" in m)
chk("CarPlaySceneDelegate 用稳定 API", "initWithText:" in m and "detailText:" in m and "accessoryType" not in m)
chk("AppDelegate 有 willConnectToSession", "willConnectToSession" in a)
chk("AppDelegate 用 sharedApplication.delegate 取 window", "UIApplication.sharedApplication.delegate" in a)
chk("AppDelegate setWindowScene + makeKeyAndVisible", "setWindowScene" in a and "makeKeyAndVisible" in a)
chk("AppDelegate 无 configurationForConnecting(避免破坏legacy)", "configurationForConnectingSceneSession" not in a)
chk("AppDelegate 用 NSLog 埋点", "[MusicFree] key window attached" in a)
chk("AppDelegate 保留 moduleName", 'self.moduleName = @"MusicFree"' in a)

# 4) pbxproj
pbx = io.open(os.path.join(ROOT, "ios", "MusicFree.xcodeproj", "project.pbxproj"), encoding="utf-8").read()
chk("pbxproj .m in Sources", "CarPlaySceneDelegate.m in Sources" in pbx)
chk("pbxproj 弱链接拆开", '"-weak_framework"' in pbx and '"CarPlay"' in pbx)
chk("pbxproj 无合并 flag", '"-weak_framework CarPlay"' not in pbx)
defs = re.findall(r'^\s*([A-F0-9]{24}) /\*.*?\*/ = \{isa = ', pbx, re.M)
dup = [k for k, v in Counter(defs).items() if v > 1 and k.startswith("C4A9C9")]
chk("新 UUID 定义唯一", len(dup) == 0, str(dup[:3]))

# 5) 既有自检
r = subprocess.run(["node", "scripts/verify-ios-patch.mjs"], cwd=ROOT,
                   capture_output=True, timeout=120)
out = (r.stdout or b"").decode("utf-8", errors="replace")
chk("verify-ios-patch 11/11", "11/11" in out, " ".join(out.strip().split("\n")[-2:]))

print()
print("=" * 50)
print("Phase 0 plan F static check:", "ALL PASS" if ok else "FAILED")
sys.exit(0 if ok else 1)
