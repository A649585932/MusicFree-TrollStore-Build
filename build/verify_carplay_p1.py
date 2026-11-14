"""CarPlay Phase 1 综合静态校验"""
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
    print(f"  [{'OK ' if cond else 'NG '}] {name} {detail.encode('ascii','replace').decode('ascii')}")
    if not cond:
        ok = False


# 1) 原生桥
bh = io.open(os.path.join(ROOT, "ios", "MusicFree", "CarPlayBridge.h"), encoding="utf-8").read()
bm = io.open(os.path.join(ROOT, "ios", "MusicFree", "CarPlayBridge.m"), encoding="utf-8").read()
chk("CarPlayBridge 是 RCTEventEmitter", "RCTEventEmitter" in bh and "RCTBridgeModule" in bh)
chk("supportedEvents 含 3 个事件", all(x in bm for x in ["CarPlayPlayTrack", "CarPlayRequestTracks", "CarPlayControl"]))
chk("JS->车机 3 个导出方法", all(x in bm for x in ["setSheets:", "setTracks:", "setNowPlaying:"]))
chk("车机->JS 3 个类方法", all(x in bm for x in ["emitPlayTrack", "emitRequestTracks", "emitControl"]))
chk("用 NSNotificationCenter 解耦", "NSNotificationCenter" in bm)

# 2) CarPlaySceneDelegate
ch = io.open(os.path.join(ROOT, "ios", "MusicFree", "CarPlaySceneDelegate.h"), encoding="utf-8").read()
cm = io.open(os.path.join(ROOT, "ios", "MusicFree", "CarPlaySceneDelegate.m"), encoding="utf-8").read()
chk("用 CPListItem.handler（稳定 API）", "item.handler" in cm)
chk("不用 CPListTemplateDelegate（签名差异）", "didSelectListItem" not in cm)
chk("歌单列表 + 点歌单 push", "rebuildRoot" in cm and "pushTracksForSheet" in cm)
chk("点曲目发播放事件", "emitPlayTrack" in cm)
chk("数据更新刷新", "dataDidUpdate" in cm and "updateSections" in cm)
chk("无老危险 init 签名", "accessoryType:" not in cm)

# 3) pbxproj
pbx = io.open(os.path.join(ROOT, "ios", "MusicFree.xcodeproj", "project.pbxproj"), encoding="utf-8").read()
chk("CarPlayBridge.m in Sources", "CarPlayBridge.m in Sources" in pbx)
chk("CarPlaySceneDelegate.m in Sources", "CarPlaySceneDelegate.m in Sources" in pbx)
defs = re.findall(r'^\s*([A-F0-9]{24}) /\*.*?\*/ = \{isa = ', pbx, re.M)
dup = [k for k, v in Counter(defs).items() if v > 1 and k.startswith("C4A9C9")]
chk("新 UUID 定义唯一", len(dup) == 0, str(dup[:3]))

# 4) JS 层
js = io.open(os.path.join(ROOT, "src", "core", "carPlay", "index.ts"), encoding="utf-8").read()
chk("JS 用 NativeEventEmitter", "NativeEventEmitter" in js)
chk("JS 订阅 3 事件", all(x in js for x in ["CarPlayRequestTracks", "CarPlayPlayTrack", "CarPlayControl"]))
chk("JS 推 setSheets/setTracks/setNowPlaying", all(x in js for x in ["setSheets", "setTracks", "setNowPlaying"]))
chk("JS 调 playWithReplacePlayList", "playWithReplacePlayList" in js)
chk("JS 非 iOS 静默降级", "Platform.OS === \"ios\"" in js)
chk("JS 幂等 setup", "started" in js)

# 5) musicSheet 新方法
ms = io.open(os.path.join(ROOT, "src", "core", "musicSheet", "index.ts"), encoding="utf-8").read()
chk("getAllSheetsForCarPlay", "getAllSheetsForCarPlay" in ms)
chk("getTracksForCarPlay", "getTracksForCarPlay" in ms)
chk("findMusicItemForCarPlay", "findMusicItemForCarPlay" in ms)

# 6) bootstrap 挂载
bs = io.open(os.path.join(ROOT, "src", "entry", "bootstrap", "bootstrap.ts"), encoding="utf-8").read()
chk("bootstrap import setupCarPlay", 'from "@/core/carPlay"' in bs)
chk("bootstrap 调 setupCarPlay()", "setupCarPlay()" in bs)

# 7) 方案 F 仍保持（主 App 不黑屏）
pl = plistlib.load(open(os.path.join(ROOT, "ios", "MusicFree", "Info.plist"), "rb"))
cfgs = (pl.get("UIApplicationSceneManifest") or {}).get("UISceneConfigurations", {})
w = cfgs.get("UIWindowSceneSessionRoleApplication", [{}])
c = cfgs.get("CPTemplateApplicationSceneSessionRoleApplication", [{}])
chk("主场景 delegateClass=AppDelegate", w and w[0].get("UISceneDelegateClassName") == "AppDelegate")
chk("CarPlay delegateClass=MFCarPlaySceneDelegate", c and c[0].get("UISceneDelegateClassName") == "MFCarPlaySceneDelegate")

# 8) 既有自检
r = subprocess.run(["node", "scripts/verify-ios-patch.mjs"], cwd=ROOT, capture_output=True, timeout=120)
out = (r.stdout or b"").decode("utf-8", errors="replace")
chk("verify-ios-patch 11/11", "11/11" in out, " ".join(out.strip().split("\n")[-2:]))

print()
print("=" * 50)
print("Phase 1 static check:", "ALL PASS" if ok else "FAILED")
sys.exit(0 if ok else 1)
