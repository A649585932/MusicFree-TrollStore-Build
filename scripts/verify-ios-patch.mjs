#!/usr/bin/env node
/**
 * MusicFree iOS / TrollStore 移植静态自检（零依赖，Windows / macOS / Linux 都能跑）
 *
 * 检查项：
 *  1. 三个 Android 原生模块是否都有 iOS 平台 shim
 *  2. shim 是否导出调用点需要的全部方法 / 枚举
 *  3. 启动必崩的 bootstrap Android 权限分支是否已修正
 *  4. Info.plist 的 iOS 必需键（图库权限、ATS、后台音频、文件共享、URL Scheme）
 *  5. fileUtils.ts 是否已绕开 iOS 上不存在的 PicturesDirectoryPath
 *  6. pbxproj 的 Bundle ID / 版本号 / 签名配置
 *  7. 打包脚本、entitlements、CI workflow 是否齐全
 *
 * 用法：node scripts/verify-ios-patch.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const read = (p) => {
    const f = path.join(root, p);
    if (!fs.existsSync(f)) throw new Error(`MISSING ${p}`);
    return fs.readFileSync(f, "utf8");
};
const exists = (p) => fs.existsSync(path.join(root, p));

const results = [];
const check = (name, fn) => {
    try {
        const detail = fn();
        results.push({ ok: true, name, detail: detail || "OK" });
    } catch (e) {
        results.push({ ok: false, name, detail: e.message });
    }
};
const assert = (cond, msg) => {
    if (!cond) throw new Error(msg);
};
const has = (text, needle, msg) => assert(text.includes(needle), msg ?? `缺少 ${needle}`);

// ---------------------------------------------------------------- 1. shim 文件
check("三个 iOS 平台 shim 存在", () => {
    const files = [
        "src/native/utils/index.ios.ts",
        "src/native/mp3Util/index.ios.ts",
        "src/native/lyricUtil/index.ios.ts",
    ];
    for (const f of files) assert(exists(f), `缺少 ${f}`);
    return files.join(", ");
});

// ---------------------------------------------------------------- 2. shim API 覆盖
check("NativeUtils shim API 完整", () => {
    const t = read("src/native/utils/index.ios.ts");
    for (const m of [
        "exitApp",
        "checkStoragePermission",
        "requestStoragePermission",
        "getWindowDimensions",
    ]) {
        has(t, `${m}:`, `NativeUtils 缺少 ${m}`);
    }
    has(t, "Dimensions.get", "getWindowDimensions 未用 Dimensions 实现");
    return "4/4 方法";
});

check("Mp3Util shim API 完整且长度对齐", () => {
    const t = read("src/native/mp3Util/index.ios.ts");
    for (const m of [
        "getBasicMeta",
        "getMediaMeta",
        "getMediaCoverImg",
        "getLyric",
        "setMediaTag",
        "getMediaTag",
    ]) {
        has(t, `${m}:`, `Mp3Util 缺少 ${m}`);
    }
    has(t, "fileNames.map", "getMediaMeta 返回数组长度必须与入参一致");
    return "6/6 方法，getMediaMeta 对齐 musicList";
});

check("LyricUtil shim 解决模块加载期崩溃", () => {
    const t = read("src/native/lyricUtil/index.ios.ts");
    // 去掉注释后再判定，避免文档里提到 NativeModules 造成误报
    const code = t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert(!code.includes("NativeModules"), "iOS shim 不应再引用 NativeModules");
    for (const m of [
        "showStatusBarLyric",
        "hideStatusBarLyric",
        "setStatusBarLyricText",
        "setStatusBarLyricTop",
        "setStatusBarLyricLeft",
        "setStatusBarLyricWidth",
        "setStatusBarLyricFontSize",
        "setStatusBarLyricAlign",
        "setStatusBarColors",
        "checkSystemAlertPermission",
        "requestSystemAlertPermission",
    ]) {
        has(t, `${m}:`, `LyricUtil 缺少 ${m}`);
    }
    has(t, "export enum NativeTextAlignment", "缺少 NativeTextAlignment 枚举");
    has(t, "LEFT = 3", "枚举值须与 Android 端一致");
    has(t, "RIGHT = 5", "枚举值须与 Android 端一致");
    has(t, "CENTER = 17", "枚举值须与 Android 端一致");
    return "11/11 方法 + 枚举，无 NativeModules 解引用";
});

// ---------------------------------------------------------------- 3. bootstrap
check("bootstrap 已跳过 iOS 上的 Android 权限分支", () => {
    const t = read("src/entry/bootstrap/bootstrap.ts");
    const guard = 'if (Platform.OS === "android") {';
    has(t, guard, "未用 Platform 包裹权限检查");

    const start = t.indexOf(guard);
    const marker = 'logger.mark("权限检查完成");';
    const end = t.indexOf(marker, start);
    assert(end > start, "找不到权限检查块结束标记");
    const block = t.slice(start, end);

    const perms = block.match(/PERMISSIONS\.ANDROID\.[A-Z_]+/g) || [];
    assert(perms.length >= 4, `权限调用数量异常（${perms.length}）`);

    // 精确判定：从守卫的 '{' 起做大括号配对，找到它的匹配 '}'。
    // 原始 bug 是「与平台守卫同层的 else」会在 iOS 上执行；
    // 现在所有 ANDROID 权限调用都必须落在这对大括号之内。
    let open = t.indexOf("{", start);
    let depth = 0;
    let close = -1;
    for (let i = open; i < t.length; i++) {
        if (t[i] === "{") depth++;
        else if (t[i] === "}") {
            depth--;
            if (depth === 0) { close = i; break; }
        }
    }
    assert(close > open, "找不到平台守卫的匹配右括号");
    const guarded = t.slice(open, close + 1);
    for (const p of perms) {
        const pos = block.indexOf(p);
        assert(pos >= 0 && start + pos <= close, `${p} 逃逸出 android 守卫`);
    }
    // 守卫之后、marker 之前不允许再出现 else 或 ANDROID 权限调用（逐行看代码，忽略注释）
    const after = t.slice(close + 1, end).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert(!/PERMISSIONS\.ANDROID/.test(after), "守卫外仍有 ANDROID 权限调用");
    assert(!/^\s*else\b/m.test(after), "平台守卫后仍存在会在 iOS 执行的 else 分支");
    assert(
        guarded.includes("if (Platform.Version >= 30)"),
        "Android 版本分支应嵌套在平台守卫内",
    );
    return "Android 权限调用已完全收敛到 android 守卫内，iOS 直达文件夹初始化";
});

// ---------------------------------------------------------------- 4. Info.plist
check("Info.plist iOS 必需键齐全", () => {
    const t = read("ios/MusicFree/Info.plist");
    const keys = [
        ["NSPhotoLibraryUsageDescription", "launchImageLibrary 必需"],
        ["NSAllowsArbitraryLoads", "插件 http 音源"],
        ["UIBackgroundModes", "后台播放"],
        ["UIFileSharingEnabled", "文件 App 导入本地音乐/插件"],
        ["LSSupportsOpeningDocumentsInPlace", "打开方式"],
        ["CFBundleURLTypes", "musicfree:// 插件深链"],
        ["ITSAppUsesNonExemptEncryption", "避免出口合规弹窗"],
    ];
    for (const [k, why] of keys) has(t, `<key>${k}</key>`, `${k}（${why}）`);
    assert(/<key>NSAllowsArbitraryLoads<\/key>\s*<true\/>/s.test(t), "NSAllowsArbitraryLoads 未置 true");
    assert(/<string>audio<\/string>/.test(t), "UIBackgroundModes 缺少 audio");
    assert(/<string>musicfree<\/string>/.test(t), "URL Scheme 缺少 musicfree");
    assert(/<string>arm64<\/string>/.test(t), "UIRequiredDeviceCapabilities 缺少 arm64");
    return `${keys.length} 个键 + arm64 值`;
});

// ---------------------------------------------------------------- 5. fileUtils
check("fileUtils 绕开 iOS 不存在的 PicturesDirectoryPath", () => {
    const t = read("src/utils/fileUtils.ts");
    has(t, "DocumentDirectoryPath", "未引入 DocumentDirectoryPath");
    has(t, 'Platform.OS === "ios"', "未做平台分支");
    has(t, 'from "react-native"', "未从 react-native 导入 Platform");
    return "iOS → DocumentDirectoryPath，Android 保持原路径";
});

// ---------------------------------------------------------------- 6. pbxproj
check("Xcode 工程 Bundle ID / 版本 / 部署目标", () => {
    const t = read("ios/MusicFree.xcodeproj/project.pbxproj");
    has(t, "app.musicfree.trollstore", "Bundle ID 未替换");
    assert(
        !t.includes("org.reactjs.native.example"),
        "仍残留 RN 模板 Bundle ID",
    );
    has(t, "MARKETING_VERSION = 0.6.2", "版本号未同步 package.json");
    has(t, "IPHONEOS_DEPLOYMENT_TARGET = 15.1", "部署目标变化，请复核 TrollStore 支持范围");
    return "app.musicfree.trollstore / 0.6.2 / iOS 15.1+";
});

// ---------------------------------------------------------------- 7. 构建资产
check("打包脚本关闭全部签名", () => {
    const t = read("scripts/build-trollstore.sh");
    for (const flag of [
        "CODE_SIGNING_ALLOWED=NO",
        "CODE_SIGNING_REQUIRED=NO",
        'CODE_SIGN_IDENTITY=""',
        "generic/platform=iOS",
        "-archivePath",
        "zip -qry",
        "Payload",
    ]) {
        has(t, flag, `打包脚本缺少 ${flag}`);
    }
    has(t, 'SCHEME="${SCHEME:-MusicFreeNew}"', "scheme 名应与共享 scheme 文件一致");
    has(t, ".tipa", "产物扩展名应为 .tipa");
    return "免签名 archive → Payload → .tipa";
});

check("entitlements 与 CI workflow 齐全", () => {
    assert(exists("scripts/trollstore.entitlements.plist"), "缺少默认 entitlements");
    assert(exists("scripts/trollstore-full-access.entitlements.plist"), "缺少可选全盘 entitlements");
    assert(exists("TROLLSTORE.md"), "缺少 TROLLSTORE.md 说明");
    const wf = read(".github/workflows/build-trollstore.yml");
    has(wf, "runs-on: macos-14", "CI 必须跑在 macOS runner");
    has(wf, "upload-artifact@v4", "CI 未上传产物");
    const stripXmlComments = (s) => s.replace(/<!--[\s\S]*?-->/g, "");
    const entRaw = read("scripts/trollstore.entitlements.plist");
    const ent = stripXmlComments(entRaw);
    has(ent, "application-identifier", "缺少 application-identifier");
    // iOS 16+ 遇到 get-task-allow 会触发 Developer Mode（182/183）；
    // 这三个是官方 banned entitlements，带上去启动即崩。
    // 判定前剥掉 XML 注释，避免注释里的说明文字造成误报。
    for (const banned of [
        "get-task-allow",
        "com.apple.private.cs.debugger",
        "dynamic-codesigning",
        "com.apple.private.skip-library-validation",
    ]) {
        assert(!ent.includes(banned), `默认 entitlements 含高危项 ${banned}`);
    }
    const full = stripXmlComments(read("scripts/trollstore-full-access.entitlements.plist"));
    has(full, "com.apple.private.security.storage.AppDataContainers", "全盘版缺 AppDataContainers");
    assert(!full.includes("get-task-allow"), "全盘版不应含 get-task-allow");
    return "默认 entitlements 无高危项 + 可选全盘版 + macOS CI";
});

// ---------------------------------------------------------------- 输出
const failed = results.filter((r) => !r.ok);
for (const r of results) {
    console.log(`${r.ok ? "  ✓" : "  ✗"} ${r.name}\n      ${r.detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} 项通过`);
if (failed.length) {
    console.error("\n自检未通过，请先修复以上项目再打包。");
    process.exit(1);
}
console.log("✅ iOS / TrollStore 移植静态自检通过，可以执行 scripts/build-trollstore.sh");
