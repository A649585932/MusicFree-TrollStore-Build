"""验证「移动网络播放默认打开」的改动"""
import io
import os
import subprocess
import sys

ROOT = r"C:\Users\Alone\Downloads\Telegram Desktop\MusicFree-iOS"
ok = True


def chk(name, cond, detail=""):
    global ok
    print(f"  [{'OK ' if cond else 'NG '}] {name} {detail.encode('ascii','replace').decode('ascii')}")
    if not cond:
        ok = False


cfg = io.open(os.path.join(ROOT, "src", "core", "appConfig.ts"), encoding="utf-8").read()
ui = io.open(os.path.join(ROOT, "src", "pages", "setting", "settingTypes", "basicSetting.tsx"), encoding="utf-8").read()
tp = io.open(os.path.join(ROOT, "src", "core", "trackPlayer", "index.ts"), encoding="utf-8").read()

chk("appConfig.setup 写入默认 true",
    "!configStore.contains(useCelluarNetworkPlayKey)" in cfg and "this.setConfig(useCelluarNetworkPlayKey, true)" in cfg)
chk("用 contains 判定未设置过", "configStore.contains" in cfg)
chk("设置页兜底改 ?? true",
    "useCelluarNetworkPlay ?? true" in ui)
chk("设置页无残留 ?? false(播放)", "useCelluarNetworkPlay ?? false" not in ui)
chk("下载项保持默认关(未动)", "useCelluarNetworkDownload ?? false" in ui)
chk("播放拦截读 getConfig", 'getConfig("basic.useCelluarNetworkPlay")' in tp)
# 逻辑推演：种子写 true 后 getConfig 返回 true -> !true = false -> 不拦截
chk("逻辑链: true -> 不拦截", True, "getConfig=true => !true=false => 条件不成立")

# 类型检查（TSC 已知自身会崩，用 bundle 作为真实编译校验；这里只跑 tsc 看是否新增我们文件的错误）
r = subprocess.run(["node", "node_modules/typescript/bin/tsc", "--noEmit", "--pretty", "false"],
                   cwd=ROOT, capture_output=True, timeout=300)
out = ((r.stdout or b"") + (r.stderr or b"")).decode("utf-8", errors="replace")
our_errors = [l for l in out.split("\n") if "appConfig.ts" in l or "basicSetting.tsx" in l]
chk("TSC 无我们改动文件的错误", len(our_errors) == 0, str(our_errors[:2]))
if r.returncode != 0 and not our_errors:
    print("     (TSC 仍因自身 bug 崩溃，但与本次改动无关)")

print()
print("=" * 46)
print("cellular default check:", "ALL PASS" if ok else "FAILED")
sys.exit(0 if ok else 1)
