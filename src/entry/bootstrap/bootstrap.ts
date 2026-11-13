import "react-native-get-random-values";

import { getCurrentDialog, showDialog } from "@/components/dialogs/useDialog.ts";
import { ImgAsset } from "@/constants/assetsConst";
import { emptyFunction, localPluginHash, supportLocalMediaType } from "@/constants/commonConst";
import pathConst from "@/constants/pathConst";
import Config from "@/core/appConfig";
import downloader, { DownloadFailReason, DownloaderEvent } from "@/core/downloader";
import LocalMusicSheet from "@/core/localMusicSheet";
import lyricManager from "@/core/lyricManager";
import musicHistory from "@/core/musicHistory";
import MusicSheet from "@/core/musicSheet";
import PluginManager from "@/core/pluginManager";
import { installBuiltinPlugins } from "@/core/pluginManager/builtinInstaller";
import Theme from "@/core/theme";
import TrackPlayer from "@/core/trackPlayer";
import NativeUtils from "@/native/utils";
import { checkAndCreateDir } from "@/utils/fileUtils";
import { errorLog, trace } from "@/utils/log";
import { IPerfLogger, perfLogger } from "@/utils/perfLogger";
import PersistStatus from "@/utils/persistStatus";
import Toast from "@/utils/toast";
import * as SplashScreen from "expo-splash-screen";
import {  Linking, Platform } from "react-native";
import { PERMISSIONS, check, request } from "react-native-permissions";
import RNTrackPlayer, { AppKilledPlaybackBehavior, Capability } from "react-native-track-player";
import i18n from "@/core/i18n";
import bootstrapAtom from "./bootstrap.atom";
import { getDefaultStore } from "jotai";


// 依赖管理
PluginManager.injectDependencies(Config);
musicHistory.injectDependencies(Config);
TrackPlayer.injectDependencies(Config, musicHistory, PluginManager);
downloader.injectDependencies(Config, PluginManager);
lyricManager.injectDependencies(TrackPlayer, Config, PluginManager);
MusicSheet.injectDependencies(Config);


async function bootstrapImpl() {
    await SplashScreen.preventAutoHideAsync()
        .then(result =>
            console.log(
                `SplashScreen.preventAutoHideAsync() succeeded: ${result}`,
            ),
        )
        .catch(console.warn); // it's good to explicitly catch and inspect any error
    const logger = perfLogger();
    // 1. 检查权限
    // iOS / TrollStore：沙盒内 Documents 与 Caches 天然可读写，
    // 不需要也不存在 Android 的 READ/WRITE_EXTERNAL_STORAGE，
    // 若走原 else 分支会用 PERMISSIONS.ANDROID.* 调用 react-native-permissions，
    // 在 iOS 上直接抛错并让 bootstrap 进入 Fatal 状态。这里显式跳过。
    if (Platform.OS === "android") {
        if (Platform.Version >= 30) {
            const hasPermission = await NativeUtils.checkStoragePermission();
            if (
                !hasPermission &&
                !PersistStatus.get("app.skipBootstrapStorageDialog")
            ) {
                showDialog("CheckStorage");
            }
        } else {
            const [readStoragePermission, writeStoragePermission] =
                await Promise.all([
                    check(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE),
                    check(PERMISSIONS.ANDROID.WRITE_EXTERNAL_STORAGE),
                ]);
            if (
                !(
                    readStoragePermission === "granted" &&
                    writeStoragePermission === "granted"
                )
            ) {
                await request(PERMISSIONS.ANDROID.READ_EXTERNAL_STORAGE);
                await request(PERMISSIONS.ANDROID.WRITE_EXTERNAL_STORAGE);
            }
        }
    }
    logger.mark("权限检查完成");

    // 1.5 覆盖升级时清理旧标记（必须在初始化插件之前）
    await migrateOnUpgrade();

    // 2. 数据初始化
    /** 初始化路径 */
    await setupFolder();
    trace("文件夹初始化完成");
    logger.mark("文件夹初始化完成");



    // 加载配置
    await Promise.all([
        Config.setup().then(() => {
            logger.mark("Config");
        }),
        MusicSheet.setup().then(() => {
            logger.mark("MusicSheet");
        }),
        musicHistory.setup().then(() => {
            logger.mark("musicHistory");
        }),
    ]);
    trace("配置初始化完成");
    logger.mark("配置初始化完成");

    // 加载插件（带超时保护：插件多时 setup 会逐个读文件+执行 js，
    // 第二次启动因为已有插件而变慢。超过 3 秒就先放行，后台继续加载。）
    await Promise.race([
        PluginManager.setup()
            .then(() => {
                logger.mark("插件初始化完成");
                trace("插件初始化完成");
            })
            .catch(e => {
                errorLog("插件初始化失败", e);
            }),
        new Promise<void>(resolve =>
            setTimeout(() => {
                trace("插件初始化超时，先放行界面");
                resolve();
            }, 3000),
        ),
    ]);

    // 内置音源：后台增量补齐，不阻塞启动
    installBuiltinPluginsIfNeeded().catch(e => {
        errorLog("内置音源初始化失败", e);
    });
    logger.mark("内置音源已排入后台");

    await initTrackPlayer(logger).catch(err => {
        // 初始化播放器出错，延迟初始化
        const bootstrapState = getDefaultStore().get(bootstrapAtom);

        if (bootstrapState.state === "Loading") {
            getDefaultStore().set(bootstrapAtom, {
                state: "TrackPlayerError",
                reason: err,
            });
        }
    });

    await LocalMusicSheet.setup();
    trace("本地音乐初始化完成");
    logger.mark("本地音乐初始化完成");

    Theme.setup();
    trace("主题初始化完成");
    logger.mark("主题初始化完成");

    extraMakeup();

    i18n.setup();
    logger.mark("语言模块初始化完成");
    
    ErrorUtils.setGlobalHandler(error => {
        errorLog("未捕获的错误", error);
    });
}

/**
 * 覆盖升级时清理旧状态。
 *
 * TrollStore 覆盖安装会保留 App 的数据容器，导致：
 *   - 旧的 builtinSubscribeDone 标记让「自动补插件」永远跳过；
 *   - 旧 MMKV 里的插件缓存让新插件逻辑不生效。
 *
 * 这里用 CFBundleVersion 作为版本指纹：构建号变化 = 新版本，
 * 清掉与「一次性初始化」相关的标记，让新逻辑从头跑一遍。
 * 用户数据（歌单、配置、播放列表）一律不动。
 */
async function migrateOnUpgrade() {
    try {
        const DeviceInfo = require("react-native-device-info").default;
        const currentBuild = String(DeviceInfo.getBuildNumber?.() ?? "");
        if (!currentBuild) {
            return;
        }
        const lastBuild = PersistStatus.get("app.lastBuildVersion");
        if (lastBuild === currentBuild) {
            return;
        }

        // 首次运行（无记录）也走这里：清掉可能残留的旧标记
        trace(`版本变更 ${lastBuild ?? "<首次>"} -> ${currentBuild}，重置初始化标记`);
        PersistStatus.set("app.builtinSubscribeDone", undefined as any);
        PersistStatus.set("app.lastBuildVersion", currentBuild);
    } catch (e) {
        errorLog("版本迁移失败", e);
    }
}

/** 初始化 */
async function setupFolder() {
    await Promise.all([
        checkAndCreateDir(pathConst.dataPath),
        checkAndCreateDir(pathConst.logPath),
        checkAndCreateDir(pathConst.cachePath),
        checkAndCreateDir(pathConst.pluginPath),
        checkAndCreateDir(pathConst.lrcCachePath),
        checkAndCreateDir(pathConst.downloadCachePath),
        checkAndCreateDir(pathConst.localLrcPath),
        checkAndCreateDir(pathConst.downloadPath).then(() => {
            checkAndCreateDir(pathConst.downloadMusicPath);
        }),
    ]);
}

/**
 * 内置音源：每次启动增量补齐，用户无需任何操作。
 *
 * 行为：
 *   - 拉取订阅清单，逐个检查哪些还没装，只装缺的；
 *   - 已装的跳过（不会重复下载）；
 *   - 用户手动删掉的，下次启动自动补回（这就是「内置」的语义）；
 *   - 全程静默，失败只记日志，绝不阻断启动。
 */
async function installBuiltinPluginsIfNeeded() {
    try {
        const r = await installBuiltinPlugins({ force: false });

        if (r.okCount > 0) {
            trace(
                `\u5185\u7f6e\u97f3\u6e90\u8865\u9f50 ${r.okCount} \u4e2a\uff1a${r.names.join("\u3001")}`,
            );
            setTimeout(() => {
                Toast.success(`\u5df2\u81ea\u52a8\u5b89\u88c5 ${r.okCount} \u4e2a\u97f3\u6e90`);
            }, 2000);
        } else if (r.skippedCount > 0) {
            trace(`\u5185\u7f6e\u97f3\u6e90\u5df2\u9f50\u5168\uff08${r.skippedCount} \u4e2a\uff09`);
        }

        if (r.failCount > 0) {
            errorLog("\u90e8\u5206\u5185\u7f6e\u97f3\u6e90\u5b89\u88c5\u5931\u8d25", r.failures);
        }
    } catch (e) {
        errorLog("\u5185\u7f6e\u97f3\u6e90\u521d\u59cb\u5316\u5931\u8d25", e);
    }
}


export async function initTrackPlayer(logger?: IPerfLogger) {
    try {
        await RNTrackPlayer.setupPlayer({
            maxCacheSize:
                Config.getConfig("basic.maxCacheSize") ?? 1024 * 1024 * 512,
        });
    } catch (e: any) {
        if (
            e?.message !==
            "The player has already been initialized via setupPlayer."
        ) {
            throw e;
        }
    }
    logger?.mark("加载播放器");

    const capabilities = Config.getConfig("basic.showExitOnNotification")
        ? [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
            Capability.Stop,
        ]
        : [
            Capability.Play,
            Capability.Pause,
            Capability.SkipToNext,
            Capability.SkipToPrevious,
        ];
    await RNTrackPlayer.updateOptions({
        icon: ImgAsset.logoTransparent,
        progressUpdateEventInterval: 1,
        android: {
            alwaysPauseOnInterruption: true,
            appKilledPlaybackBehavior:
                AppKilledPlaybackBehavior.ContinuePlayback,
        },
        capabilities: capabilities,
        compactCapabilities: capabilities,
        notificationCapabilities: [...capabilities, Capability.SeekTo],
    });
    logger?.mark("播放器初始化完成");
    trace("播放器初始化完成");

    await TrackPlayer.setupTrackPlayer();
    trace("播放列表初始化完成");
    logger?.mark("播放列表初始化完成");

    await lyricManager.setup();

    logger?.mark("歌词初始化完成");
}


/** 不需要阻塞的 */
async function extraMakeup() {
    // 自动更新
    try {
        if (Config.getConfig("basic.autoUpdatePlugin")) {
            const lastUpdated = PersistStatus.get("app.pluginUpdateTime") || 0;
            const now = Date.now();
            if (Math.abs(now - lastUpdated) > 86400000) {
                PersistStatus.set("app.pluginUpdateTime", now);
                const plugins = PluginManager.getEnabledPlugins();
                for (let i = 0; i < plugins.length; ++i) {
                    const srcUrl = plugins[i].instance.srcUrl;
                    if (srcUrl) {
                        // 静默失败
                        await PluginManager.installPluginFromUrl(srcUrl).catch(emptyFunction);
                    }
                }
            }
        }
    } catch { }

    /**
     * 处理外部唤起的 URL。
     *
     * 支持的入口（可在 Safari / 桌面快捷指令 / 其他 App 里直接点）：
     *   musicfree://install/<url1>,<url2>,...   批量安装插件（首次启动也会处理）
     *   <path>.js                                本地/网络插件文件
     *   <path>.mp3|flac|...                      本地音频直接播放
     */
    async function handleLinkingUrl(url: string) {
        try {
            const INSTALL_PREFIX = "musicfree://install/";
            if (url.startsWith(INSTALL_PREFIX)) {
                const raw = decodeURIComponent(url.slice(INSTALL_PREFIX.length));
                const urls = raw
                    .split(/[,;\n]+/)
                    .map(it => it.trim())
                    .filter(Boolean);

                if (!urls.length) {
                    Toast.warn("没有解析到插件地址");
                    return;
                }

                Toast.warn(`正在安装 ${urls.length} 个插件…`);

                const results = await Promise.all(
                    urls.map(async it => {
                        try {
                            const res = await PluginManager.installPluginFromUrl(it);
                            return { url: it, ok: true, name: (res as any)?.pluginName };
                        } catch (e: any) {
                            return { url: it, ok: false, message: e?.message ?? "未知错误" };
                        }
                    }),
                );

                const okList = results.filter(r => r.ok);
                const failList = results.filter(r => !r.ok);

                if (okList.length) {
                    const names = okList
                        .map(r => r.name)
                        .filter(Boolean)
                        .join("、");
                    Toast.success(
                        `已安装 ${okList.length} 个插件${names ? `：${names}` : ""}`,
                    );
                }
                if (failList.length) {
                    Toast.warn(
                        `${failList.length} 个插件安装失败${failList[0]?.message ? `：${failList[0].message}` : ""}`,
                    );
                }
            } else if (url.endsWith(".js")) {
                PluginManager.installPluginFromLocalFile(url, {
                    notCheckVersion: Config.getConfig(
                        "basic.notCheckPluginVersion",
                    ),
                })
                    .then(res => {
                        if (res.success) {
                            Toast.success(`插件「${res.pluginName}」安装成功~`);
                        } else {
                            Toast.warn("安装失败: " + res.message);
                        }
                    })
                    .catch(e => {
                        console.log(e);
                        Toast.warn(e?.message ?? "无法识别此插件");
                    });
            } else if (supportLocalMediaType.some(it => url.endsWith(it))) {
                // 本地播放
                const musicItem = await PluginManager.getByHash(
                    localPluginHash,
                )?.instance?.importMusicItem?.(url);
                console.log(musicItem);
                if (musicItem) {
                    TrackPlayer.play(musicItem);
                }
            }
        } catch { }
    }

    // 开启监听
    Linking.addEventListener("url", data => {
        if (data.url) {
            handleLinkingUrl(data.url);
        }
    });
    const initUrl = await Linking.getInitialURL();
    if (initUrl) {
        handleLinkingUrl(initUrl);
    }

    if (Config.getConfig("basic.autoPlayWhenAppStart")) {
        TrackPlayer.play();
    }
}


function bindEvents() {
    // 下载事件
    downloader.on(DownloaderEvent.DownloadError, (reason) => {
        if (reason === DownloadFailReason.NetworkOffline) {
            Toast.warn("当前无网络连接，请等待网络恢复后重试");
        } else if (reason === DownloadFailReason.NotAllowToDownloadInCellular) {
            if (getCurrentDialog()?.name !== "SimpleDialog") {
                showDialog("SimpleDialog", {
                    title: "流量提醒",
                    content: "当前非WIFI环境，为节省流量，请到侧边栏设置中打开【使用移动网络下载】功能后方可继续下载",
                });
            }
        }
    });

    downloader.on(DownloaderEvent.DownloadQueueCompleted, () => {
        Toast.success("下载任务已完成");
    });
}

export default async function () {
    try {
        getDefaultStore().set(bootstrapAtom, {
            "state": "Loading",
        });
        await bootstrapImpl();
        bindEvents();
        getDefaultStore().set(bootstrapAtom, {
            "state": "Done",
        });
    } catch (e: any) {
        errorLog("初始化出错", e);
        if (getDefaultStore().get(bootstrapAtom).state === "Loading") {
            getDefaultStore().set(bootstrapAtom, {
                state: "Fatal",
                reason: e,
            });
        }
    }
    // 隐藏开屏动画
    console.log("HIDE");
    await SplashScreen.hideAsync();
}
