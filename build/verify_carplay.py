"""CarPlay Phase 0 本地静态校验"""
import io
import os
import plistlib
import re
import subprocess
import sys

ROOT = r"C:\Users\Alone\Downloads\Telegram Desktop\MusicFree-iOS"
PY = sys.executable
ok = True


def chk(name, cond, detail=""):
    global ok
    mark = "OK " if cond else "NG "
    # 控制台可能是 GBK，detail 里的中文/emoji 全部 ascii 化
    safe = detail.encode("ascii", "replace").decode("ascii")
    print(f"  [{mark}] {name} {safe}")
    if not cond:
        ok = False


# 1) Info.plist 合法 + SceneManifest 键
info = os.path.join(ROOT, "ios", "MusicFree", "Info.plist")
try:
    pl = plistlib.load(open(info, "rb"))
    chk("Info.plist 可解析", True)
except Exception as e:
    pl = {}
    chk("Info.plist 可解析", False, str(e))

sm = pl.get("UIApplicationSceneManifest")
chk("UIApplicationSceneManifest 存在", isinstance(sm, dict))
if isinstance(sm, dict):
    chk("UIApplicationSupportsMultipleScenes=NO", sm.get("UIApplicationSupportsMultipleScenes") is False)
    cfgs = sm.get("UISceneConfigurations", {})
    chk("CPTemplateApplicationSceneSessionRoleApplication 存在",
        "CPTemplateApplicationSceneSessionRoleApplication" in cfgs)
    chk("UIWindowSceneSessionRoleApplication 存在",
        "UIWindowSceneSessionRoleApplication" in cfgs)
    carplay = cfgs.get("CPTemplateApplicationSceneSessionRoleApplication", [{}])
    chk("CarPlay delegate = MFCarPlaySceneDelegate",
        carplay and carplay[0].get("UISceneDelegateClassName") == "MFCarPlaySceneDelegate")
    win = cfgs.get("UIWindowSceneSessionRoleApplication", [{}])
    chk("主场景不带 StoryboardFile（避免 nib 崩溃）",
        win and "UISceneStoryboardFile" not in win[0])
    chk("UILaunchScreen 仍保留", isinstance(pl.get("UILaunchScreen"), dict))

# 2) entitlements
ent = os.path.join(ROOT, "scripts", "trollstore.entitlements.plist")
try:
    e = plistlib.load(open(ent, "rb"))
    chk("entitlements 可解析", True)
    chk("carplay-audio = true", e.get("com.apple.developer.carplay-audio") is True)
    chk("application-identifier = app.musicfree.ios",
        e.get("application-identifier") == "app.musicfree.ios")
    chk("keychain 同步修正", "app.musicfree.ios" in str(e.get("keychain-access-groups")))
except Exception as ex:
    chk("entitlements 可解析", False, str(ex))

# 3) 源文件存在 + 内容关键点
h = io.open(os.path.join(ROOT, "ios", "MusicFree", "CarPlaySceneDelegate.h"), encoding="utf-8").read()
m = io.open(os.path.join(ROOT, "ios", "MusicFree", "CarPlaySceneDelegate.m"), encoding="utf-8").read()
a = io.open(os.path.join(ROOT, "ios", "MusicFree", "AppDelegate.mm"), encoding="utf-8").read()
chk("CarPlaySceneDelegate.h 声明 delegate", "CPTemplateApplicationSceneDelegate" in h)
chk("CarPlaySceneDelegate.m 实现 didConnect", "didConnectInterfaceController" in m)
chk("CarPlaySceneDelegate.m 用 setRootTemplate", "setRootTemplate" in m)
chk("AppDelegate 实现 configurationForConnecting", "configurationForConnectingSceneSession" in a)
chk("AppDelegate 判断 CarPlay role", "CPTemplateApplicationSceneSessionRoleApplication" in a)
chk("AppDelegate import CarPlaySceneDelegate.h", '#import "CarPlaySceneDelegate.h"' in a)
chk("AppDelegate 保留 moduleName=MusicFree", 'self.moduleName = @"MusicFree"' in a)

# 4) pbxproj
pbx = io.open(os.path.join(ROOT, "ios", "MusicFree.xcodeproj", "project.pbxproj"), encoding="utf-8").read()
chk("pbxproj 含 .m in Sources", "CarPlaySceneDelegate.m in Sources" in pbx)
chk("pbxproj 含 .h fileRef", "CarPlaySceneDelegate.h" in pbx)
chk("pbxproj 弱链接 CarPlay（拆分格式）",
    '"-weak_framework"' in pbx and '"CarPlay"' in pbx,
    f'weak={pbx.count(chr(34)+"-weak_framework"+chr(34))} carplay={pbx.count(chr(34)+"CarPlay"+chr(34))}')
chk("pbxproj 无合并的单 flag（会编译失败）",
    '"-weak_framework CarPlay"' not in pbx)
# UUID 唯一性：同一个 id 允许出现多次（引用），但作为「定义」只能定义一次
# 定义形如 `XXXX /* ... */ = {isa = ...`，统计这种形态
defs = re.findall(r'^\s*([A-F0-9]{24}) /\*.*?\*/ = \{isa = ', pbx, re.M)
from collections import Counter
dup = [k for k, v in Counter(defs).items() if v > 1 and k.startswith("C4A9C9")]
chk("new UUID definitions unique", len(dup) == 0, str(dup[:3]))

# 既有自检脚本
r = subprocess.run(["node", "scripts/verify-ios-patch.mjs"], cwd=ROOT,
                   capture_output=True, timeout=120)
out = (r.stdout or b"").decode("utf-8", errors="replace")
tail = out.strip().split("\n")[-2:]
chk("verify-ios-patch 11/11", "11/11" in out, " ".join(tail))

print()
print("=" * 50)
print("Phase 0 static check:", "ALL PASS" if ok else "FAILED")
sys.exit(0 if ok else 1)
