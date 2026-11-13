# MusicFree → iOS / TrollStore 移植说明

> 结论先说：**这个仓库不用「改成 iOS」**。它本身就是 React Native 0.76.5 + Expo 52 工程，
> 根目录带着完整的 `ios/`（`MusicFree.xcodeproj`、`Podfile`、`AppDelegate.mm`、`Info.plist`），
> 只是作者只发布了 Android APK，iOS 端留着 RN 模板状态且有几处 Android 专属代码会让 App 一启动就崩。
> 本次改动 = **补齐 iOS 降级实现 + 修启动崩溃 + 关签名编译 + 打成 `.tipa`**。
> TrollStore 靠 CoreTrust 永久签名，所以整个流程**不需要 Apple 开发者账号、不需要证书、不需要描述文件**。

---

## 0. 支持范围

| 项 | 值 |
| --- | --- |
| 源版本 | MusicFree 0.6.2（`master`） |
| React Native | 0.76.5（React 18.3.1），Expo SDK 52 |
| 最低系统 | iOS 15.1（`IPHONEOS_DEPLOYMENT_TARGET`，沿用工程原有值） |
| 架构 | arm64 / arm64e 真机（`UIRequiredDeviceCapabilities=arm64`） |
| Bundle ID | `app.musicfree.trollstore` |
| 产物 | `build/MusicFree.trollstore.tipa` |
| 签名 | 免签名 archive → **不伪签**（`SIGN_TOOL=none`）→ TrollStore 安装时内置 ldid 递归伪签 |

官方支持范围（[TrollStore README](https://github.com/opa334/TrollStore/blob/main/README.md)）：
**iOS 14.0 beta 2 – 16.6.1、16.7 RC (20H18)、17.0**；
`16.7.x`（RC 除外）与 `17.0.1+` 明确列入 NEVER supported。设备不在此列先装好 TrollStore 再说。

TrollStore 用的是 AMFI/CoreTrust 多签名者校验缺陷，把 IPA 里的 App 装成「System」app 并永久签名。
图标缓存重载后 App 会退回「User」状态失去可启动性，所以 **Persistence Helper** 要装进一个系统 App，
这跟 entitlements 无关，是 TrollStore 自身设置项。

---

## 1. 为什么原工程在 iOS 上会崩（改动依据）

### 1.1 三个只有 Android 实现的原生模块

`src/native/` 下有三个直接取 `NativeModules.*` 的桥，iOS 上都是 `undefined`：

| 模块 | Android 实现 | iOS 后果 |
| --- | --- | --- |
| `native/utils` (`NativeUtils`) | `exitApp` / `checkStoragePermission` / `requestStoragePermission` / `getWindowDimensions` | `panelBase.tsx:167` 在渲染时**同步**调用 `getWindowDimensions()` → 红屏 |
| `native/mp3Util` (`Mp3Util`) | ID3 标签读写 | 导入本地音乐时 `getMediaMeta` 抛错 |
| `native/lyricUtil` (`LyricUtil`) | 状态栏悬浮歌词 | **模块加载期**就执行 `LyricUtil.showStatusBarLyric` → JS Bundle 初始化失败、白屏，最致命 |

处理方式：新增 `index.ios.ts` 平台文件。Metro 解析目录时 `index.ios.ts` 优先于 `index.ts`，
**Android 原文件一行未改**，两套平台互不干扰。

- `NativeUtils`：`Dimensions.get("window")` 提供窗口尺寸；权限恒 `true`；`exitApp` 降级为 no-op。
- `Mp3Util`：返回空元数据 / 空封面 / 空歌词；`getMediaMeta` 返回与入参等长的 `{}` 数组，
  保证 `localMusicSheet.ts:170` 的 `metas[index]` 对齐。标题回退文件名。
- `LyricUtil`：全部方法 no-op；`checkSystemAlertPermission` 返回 `true`，
  让设置页开关走成功分支，不再反复弹「请打开悬浮窗权限」。`NativeTextAlignment` 枚举值保持 3/5/17。

### 1.2 `bootstrap.ts` 的 Android 权限分支

原逻辑：`if (android && Version>=30) {...} else { ... PERMISSIONS.ANDROID.* ... }`。
iOS 会掉进 `else`，用 `react-native-permissions` 请求 Android 权限 → 抛错 →
bootstrap 落到 `Fatal` 状态。已把整个权限块收进 `if (Platform.OS === "android")` 内。

### 1.3 `fileUtils.ts` 的 `PicturesDirectoryPath`

`react-native-fs` 在 iOS 上没这个常量（`undefined`），原代码拼出 `undefined/MusicFree/`，
`mkdir` 必失败。已按平台改用 `DocumentDirectoryPath`。

### 1.4 `Info.plist`

原文件是 RN 模板，缺 `NSPhotoLibraryUsageDescription`（`launchImageLibrary` 在
`editMusicSheetInfo.tsx` / `editSheetDetail.tsx` / `body.tsx` 被调用，缺描述会直接 crash）；
`NSAllowsArbitraryLoads=false` 会拦掉插件的 http 音源；没声明后台音频；没文件共享；
没 `musicfree://` URL Scheme（`bootstrap.ts:229` 的插件深链安装会失效）。全部补齐。

### 1.5 `project.pbxproj`

- Bundle ID 从 RN 模板 `org.reactjs.native.example.$(PRODUCT_NAME:rfc1034identifier)` 换成固定 ID。
- `MARKETING_VERSION` 从 `1.0` 同步到 `0.6.2`。
- 保留 iOS 15.1 部署目标；签名开关由构建脚本在命令行覆盖，不改工程文件。

---

## 2. 一键构建（有 Mac 就用这个）

```bash
# 前提：macOS + Xcode（已 xcode-select）+ Node >= 18 + CocoaPods
# 可选：brew install ldid
cd MusicFree-iOS
bash scripts/build-trollstore.sh
```

脚本六步：

1. `npm ci`（上游 `package-lock.json` 与 `package.json` 不同步、缺 `fsevents` 与
   `lightningcss-*` 可选包，`npm >= 10` 会报 `EUSAGE`；脚本已自动回退
   `npm install` 修复 lockfile，不改仓库里的 lock 也能编过）
2. `cd ios && pod install`（生成 `.xcworkspace` 与 `Pods/`、`ExpoModulesProvider`）
3. `xcodebuild -workspace ios/MusicFree.xcworkspace -scheme MusicFreeNew \
   -configuration Release -sdk iphoneos -destination generic/platform=iOS \
   -archivePath build/MusicFree.xcarchive clean archive`，并传入
   `CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY="" ...`
   —— 这一步同时执行工程里的 **Bundle React Native code and images** 脚本，
   把 `main.jsbundle` 与资源打进 `.app`，保证离线可启动。
4. 从 `MusicFree.xcarchive/Products/Applications/MusicFree.app` 拷到 `build/trollstore/Payload/`
5. **默认跳过伪签**（`SIGN_TOOL=none`）。官方链路是：TrollStore 的 `installIpa()`
   调 `signApp()`，用内置 ldid 对主 Mach-O / bundle 做 ad-hoc 签名并应用 CoreTrust bypass，
   所以打包机上完全不需要 ldid / codesign。只有要自定义 entitlements（JIT、全盘访问、
   root helper）时才设 `SIGN_TOOL=ldid|codesign|auto`：
   - `ldid -S<entitlements.plist> <binary>` 写 entitlements 到 Mach-O
   - `codesign --force --sign - --entitlements ... <app>`（ad-hoc；`--deep` 在 macOS 13 起
     已废弃且不可靠，嵌套 framework 逐个签或干脆交给 TrollStore）
6. `cd build/trollstore && zip -qry ../MusicFree.trollstore.tipa Payload`
   （`-y` 保留 framework 里的符号链接，`-x` 排除 `__MACOSX` / `.DS_Store`；
   `Payload/` 必须在 zip 最外层，里面只放一个主 `.app` 最稳）

> `.tipa` 与 `.ipa` 内部格式完全相同，都是 `Payload/xxx.app/...` 的 zip。
> TrollStore 的 `Info.plist` 注册了 `com.opa334.trollstore.tipa`（扩展名 `tipa`，
> MIME `application/trollstore-ipa`），同时也注册普通 `.ipa`；改后缀只是为了
> 让 AirDrop /「打开方式」直接落到 TrollStore。两种后缀都能装。

调优参数：

```bash
SCHEME=MusicFreeNew NEW_ARCH=1 SIGN_TOOL=ldid bash scripts/build-trollstore.sh
SKIP_NPM=1 SKIP_POD_INSTALL=1 bash scripts/build-trollstore.sh   # 二次构建加速
```

> **scheme 坑**：共享 scheme 文件叫 `MusicFreeNew.xcscheme`，而 target 名是 `MusicFree`。
> `xcodebuild -scheme` 要的是 **scheme 文件名**，所以默认 `SCHEME=MusicFreeNew`。写错会报
> `Scheme MusicFree is not currently configured for the archive action`。

> **New Architecture**：默认 `NEW_ARCH=0` 关掉新架构。仓库里 `react-native-mmkv@2.12.2`、
> `react-native-fs@2.20.0` 等老库在 Fabric/Bridgeless 下容易编不过；确需开启时先单独验证。

### 静态自检（Windows 上也能跑，不需要 Mac）

```bash
node scripts/verify-ios-patch.mjs
```

### 本机实测结果（已在 Windows 上跑通，无需 Mac 即可验证 JS 侧）

| 验证项 | 命令 | 结果 |
| --- | --- | --- |
| 移植自检 | `node scripts/verify-ios-patch.mjs` | ✅ **10/10 通过** |
| TypeScript 全量类型检查 | `npx tsc --noEmit --pretty false` | ✅ **0 错误** |
| iOS 离线 JS bundle | `npx expo export:embed --platform ios --dev false --entry-file index.js --bundle-output build/bundle-check/main.jsbundle --assets-dest build/bundle-check/assets` | ✅ **2010 modules / 14s / 4,265,459 字节**，26 个资源 |
| sourcemap 平台解析 | 解析 `main.map` 的 `sources` | ✅ 命中 `src/native/{utils,mp3Util,lyricUtil}/index.ios.ts` 共 **3** 个；Android `index.ts` 泄漏 **0**；总源数 2016 |
| plist / scheme XML 合法性 | `plistlib.load` / `minidom.parse` | ✅ `PLIST_OK` / `SCHEME_XML_OK` |

> 注意：上游 `package-lock.json` 与 `package.json` 不同步，`npm ci` 在 npm ≥ 10 会报
> `EUSAGE`（缺 `fsevents` 与 `lightningcss-*` 各平台可选包）。本机用
> `npm install --no-audit --no-fund`（1737 包 / 28s）修复后上述验证全部通过；
> 打包脚本已内置该回退，CI 上同样有效。

剩下只有 `pod install` + `xcodebuild` + `zip` 三步必须在 macOS 上执行，
GitHub Actions 的 `macos-14` runner 已配好，见 §3。

---

## 3. 没 Mac：GitHub Actions 白嫖 macOS runner

本仓库已加 `.github/workflows/build-trollstore.yml`：

1. Fork / push 到你的 GitHub 仓库
2. Actions → **Build MusicFree TrollStore TIPA** → Run workflow
3. 跑完下载 artifact `MusicFree-TrollStore-<sha>`，里面就是 `.tipa`
4. `macos-14` runner 自带 Xcode / CocoaPods，`npm ci → pod install → xcodebuild → zip` 全自动，
   约 20–40 分钟。`workflow_dispatch` 里可选 `new_arch` 与 `sign_tool`。
   失败时同时上传 `build/xcodebuild.log` 便于排错。

---

## 4. 安装到 iPhone

1. 把 `.tipa` 传进手机：AirDrop / Safari 下载 / 文件 App / 微信文件传输都行。
2. 在 **TrollStore** 里打开这个 `.tipa` → **Install**。
   （`.tipa` 与 `.ipa` 结构完全相同，只是扩展名让 TrollStore 直接接管；
   若手上是 `.ipa`，TrollStore 也能装，二选一即可。）
3. TrollStore 用自己的 CoreTrust 证书做**永久签名**，重启、断网、过 7 天都不会失效。
4. 首次启动若弹「不受信任的企业开发者」：TrollStore → Settings → **Refresh App Registrations**，
   或 设置 → 通用 → VPN 与设备管理 → 信任该描述文件。
5. 桌面出现 MusicFree → 打开 → 侧边栏「插件管理」订阅音源插件，即可使用。

### 导入本地音乐 / 插件

`UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace` 已开启：

- 「文件」App → 我的 iPhone → MusicFree → 把 mp3 / `.js` 插件丢进 Documents
- 或在其他 App 里对文件点「共享 → 用 MusicFree 打开」
- 插件深链：`musicfree://install/<URL编码的插件地址>`（可逗号分隔多个），
  已通过 `CFBundleURLTypes` 注册，对应 `bootstrap.ts` 的 `handleLinkingUrl`

---

## 5. iOS 端功能对照（诚实清单）

| 功能 | iOS / TrollStore 状态 | 说明 |
| --- | --- | --- |
| 插件音源、搜索、播放、歌单、下载、歌词 | ✅ 可用 | 纯 JS + `react-native-track-player` / `expo-file-system` / `axios`，跨端 |
| 后台播放 / 锁屏控制 / 耳机线控 | ✅ 可用 | `UIBackgroundModes=audio` + TrackPlayer |
| http 音源、自签名 https | ✅ 可用 | ATS `NSAllowsArbitraryLoads=true` |
| 图库选封面 / 主题背景 | ✅ 可用 | 补齐相册权限描述 |
| 文件 App 导入、musicfree:// 深链 | ✅ 可用 | 本次新增 |
| 状态栏 / 桌面悬浮歌词 | ⚠️ 降级为 no-op | iOS 无 Android `TYPE_APPLICATION_OVERLAY`；开关与配置保留，不崩。要做真悬浮窗见 §6 |
| 「退出应用」「返回桌面」按钮 | ⚠️ 降级为 no-op | iOS 无公开自杀 API；用 Home 手势即可 |
| 本地音乐 ID3 元数据 / 内嵌封面 / 内嵌歌词 | ⚠️ 降级为空 | 标题回退文件名，同名 `.lrc` 仍可读取；要做完整支持见 §6 |
| 存储权限管理页 | ⚠️ iOS 不显示 | 抽屉里该入口本来就只在 `Platform.OS === "android"` 时 push |
| 保存到相册 | ⚠️ 存到 App Documents | 系统相册需 CameraRoll / PhotoKit 授权，见 §6 |

**这不是功能删减，是把 Android 私有能力换成 iOS 上安全可运行的等价降级**，主功能链路完整。

---

## 6. 想继续补齐的话（可选增强）

### 6.1 真·iOS 悬浮歌词

TrollStore 环境下 App 能拿更多私有权限，可在 iOS 原生侧建一个
`UIWindow` 设 `windowLevel = UIWindowLevelStatusBar + 1`，用 `RCT_EXPORT_MODULE`
暴露同名 `LyricUtil` 方法，然后删掉 `src/native/lyricUtil/index.ios.ts` 改回 bridged 调用。
或者走灵动岛 / Live Activity（需要额外 entitlement 与 ActivityKit）。

### 6.2 完整 ID3 支持

写 `Mp3Util` 的 iOS 实现：`AVAsset` / `AVMetadataItem` 读 metadata，
`ffmpeg-kit-react-native` 或 `TagLib` 编进静态库做写入与内嵌封面 / 歌词。
接口已在本仓库 `src/native/mp3Util/index.ios.ts` 定义为 `IMp3Util`，照着实现即可。

### 6.3 退出应用

`AppDelegate.mm` 加一个 `RCT_EXPORT_MODULE` + `RCT_EXPORT_METHOD(exitApp)` 里 `exit(0)`，
再把 `src/native/utils/index.ios.ts` 的 `exitApp` 换成 `NativeModules.NativeUtils.exitApp()`。

### 6.4 全盘访问

`scripts/trollstore-full-access.entitlements.plist` 提供 `platform-application` +
`com.apple.private.security.no-container` + `no-sandbox` +
`com.apple.private.security.storage.AppDataContainers`。**默认不启用**：
`no-container` 会改变 `NSHomeDirectory()`，让 `pathConst.ts` 基于 `DocumentDirectoryPath`
的目录创建落到 `/var/mobile/Documents` 并失败。要启用必须同步把 `basePath` 改成固定绝对路径。
官方 README 说明 `platform-application` 会让沙盒部分收紧（IOKit user client 需逐项例外），
且 `no-sandbox + platform-application` 组合访问自身数据容器要补 `AppDataContainers`（已加）。

### 6.5 entitlements 红线（官方明确）

| 类别 | entitlement | 后果 |
| --- | --- | --- |
| Banned（iOS 15 / A12+） | `com.apple.private.cs.debugger`、`dynamic-codesigning`、`com.apple.private.skip-library-validation` | 缺 PPL bypass 时**启动即崩** |
| iOS 16+ Developer Mode | `get-task-allow`、`task_for_pid-allow`、`com.apple.system-task-ports*`、`com.apple.private.cs.debugger` | RootHelper 标记 `requiresDevMode`，安装返回 **182**（需开启开发者模式并重启）/ **183**（arm 失败） |
| Persistence Helper | 非 entitlement | CoreTrust 只能装 System app；图标缓存重载后退回 User 状态，需在 TrollStore 设置里装持久化助手 |

所以本仓库默认 entitlements **刻意不放 `get-task-allow`**：MusicFree 是播放器，
不需要 JIT / 调试，去掉它安装一路绿灯。TrollStore 在主二进制完全无 entitlements 时
会自动塞一份含 `get-task-allow=true` 的 fallback（用于 JIT 场景），那是它自己的行为。

**官方参考**：[TrollStore README](https://github.com/opa334/TrollStore/blob/main/README.md)、
[.tipa UTI 注册](https://github.com/opa334/TrollStore/blob/main/TrollStore/Resources/Info.plist)、
[TSAppInfo.m（Payload 解析）](https://github.com/opa334/TrollStore/blob/main/TrollStore/TSAppInfo.m)、
[RootHelper/main.m（安装与签名）](https://github.com/opa334/TrollStore/blob/main/RootHelper/main.m)、
[unarchive.m](https://github.com/opa334/TrollStore/blob/main/RootHelper/unarchive.m)、
[xcodebuild(1)](https://keith.github.io/xcode-man-pages/xcodebuild.1.html)、
[codesign(1)](https://keith.github.io/xcode-man-pages/codesign.1.html)、
[zip(1L)](https://www.unix.com/man_page/osx/1l/zip/)、
[iOS.cfw.guide 支持矩阵](https://ios.cfw.guide/installing-trollstore/)

---

## 7. 排错速查

| 现象 | 原因 / 处理 |
| --- | --- |
| `Scheme MusicFree is not currently configured for the archive action` | 用 `SCHEME=MusicFreeNew` |
| `The sandbox is not in sync with the Podfile.lock` | 重新 `cd ios && pod install` |
| 装上去白屏 / 秒退 | `.app` 里没有 `main.jsbundle`（Release 打包脚本失败）；看 `build/xcodebuild.log` 的 `Bundle React Native code and images` 段 |
| 装上去红屏 `undefined is not an object` | 检查三个 `index.ios.ts` 是否被 Metro 命中；`node scripts/verify-ios-patch.mjs` |
| `Library not loaded` / framework 缺失 | zip 时少了 `-y`，符号链接被展开；或用 `ldid` 递归签了所有 Mach-O |
| TrollStore 报签名失败 | 改用 `SIGN_TOOL=none` 让 TrollStore 完全自己签；或去掉 entitlements 里的私有项 |
| 安装返回 182 / 提示重启开开发者模式 | entitlements 里混进了 `get-task-allow` 等调试项（iOS 16+）；用本仓库默认版即可 |
| 装完秒退，日志无异常 | 检查是否误加了 banned entitlements（`dynamic-codesigning` 等，iOS 15/A12+ 启动即崩） |
| 图标缓存重载后 App 打不开 | 不是 IPA 问题：在 TrollStore 设置里装 Persistence Helper，重新注册为 System app |
| 插件接口 502 / 加载失败 | 确认 Info.plist 的 `NSAllowsArbitraryLoads` 为 `true`；`http://` 音源必需 |
| 选封面闪退 | `NSPhotoLibraryUsageDescription` 缺失；已补，改 Info.plist 时别删 |
| Xcode 报 `RCT_NEW_ARCH_ENABLED` 相关编译错 | 保持 `NEW_ARCH=0`；老库不兼容 Fabric |
| iOS 17 上装不上 | 先确认该版本在 TrollStore 支持矩阵内，与 IPA 本身无关 |

---

## 8. 改动文件清单

```
新增  src/native/utils/index.ios.ts              NativeUtils iOS 降级
新增  src/native/mp3Util/index.ios.ts            Mp3Util iOS 降级
新增  src/native/lyricUtil/index.ios.ts          LyricUtil iOS 降级（修启动白屏）
修改  src/entry/bootstrap/bootstrap.ts           Android 权限分支收敛，修启动 Fatal
修改  src/utils/fileUtils.ts                     iOS 用 DocumentDirectoryPath
修改  ios/MusicFree/Info.plist                   权限/ATS/后台音频/文件共享/URL Scheme
修改  ios/MusicFree.xcodeproj/project.pbxproj    Bundle ID、版本号
新增  scripts/build-trollstore.sh                免签名 archive → Payload → .tipa
新增  scripts/trollstore.entitlements.plist      最小 entitlements
新增  scripts/trollstore-full-access.entitlements.plist  可选全盘访问
新增  scripts/verify-ios-patch.mjs               静态自检
新增  .github/workflows/build-trollstore.yml     macOS CI 一键出包
新增  TROLLSTORE.md                              本文档
```

`src/native/*/index.ts`、`android/` 下的原生实现**完全未改动**，Android 构建行为保持原样。

> **.gitignore 坑**：上游第 82 行有 `scripts/`，会把本次新增的打包脚本全部吞掉，
> 导致 CI checkout 后 `bash: scripts/build-trollstore.sh: No such file or directory`。
> 已改为 `!scripts/` + `scripts/*` + 逐文件 `!` 白名单，并用 `git add -A -n` 验证
> 4 个脚本全部可入库。Fork 后请确认 `.gitignore` 这条改动一起带过去。
