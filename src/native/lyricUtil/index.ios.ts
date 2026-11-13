/**
 * iOS / TrollStore 版 LyricUtil（状态栏歌词）
 *
 * 原工程 src/native/lyricUtil/index.ts 在**模块加载时**就执行：
 *   const originalShowStatusBarLyric = LyricUtil.showStatusBarLyric;
 *   LyricUtil.showStatusBarLyric = showStatusBarLyric;
 * iOS 上 NativeModules.LyricUtil === undefined，这两行会直接让 JS Bundle
 * 初始化失败（白屏/红屏），是最致命的启动崩溃点，必须提供 iOS 平台文件。
 *
 * iOS 没有 Android 的 TYPE_APPLICATION_OVERLAY 悬浮窗，状态栏歌词能力
 * 在这里整体降级为 no-op；开关仍可点、配置仍可存，不会报错、不会崩。
 *
 * 想做真·iOS 桌面歌词：TrollStore 下可申请 com.apple.private... 权限
 * 挂一个 UIWindow 到 UIWindowLevelStatusBar+1，或用灵动岛 / 实时活动。
 */

/** 枚举值必须与 Android 端及 config 默认值保持完全一致 */
export enum NativeTextAlignment {
    LEFT = 3,
    RIGHT = 5,
    CENTER = 17,
}

export interface ILyricUtil {
    showStatusBarLyric: (
        initLyric?: string,
        config?: Record<string, any>,
    ) => Promise<void>;
    hideStatusBarLyric: () => Promise<void>;
    setStatusBarLyricText: (lyric: string) => Promise<void>;
    setStatusBarLyricTop: (percent: number) => Promise<void>;
    setStatusBarLyricLeft: (percent: number) => Promise<void>;
    setStatusBarLyricWidth: (percent: number) => Promise<void>;
    setStatusBarLyricFontSize: (fontSize: number) => Promise<void>;
    setStatusBarLyricAlign: (alignment: NativeTextAlignment) => Promise<void>;
    setStatusBarColors: (
        textColor: string | null,
        backgroundColor: string | null,
    ) => Promise<void>;
    checkSystemAlertPermission: () => Promise<boolean>;
    requestSystemAlertPermission: () => Promise<boolean>;
}

const noop = async () => {};

const LyricUtil: ILyricUtil = {
    showStatusBarLyric: noop,
    hideStatusBarLyric: noop,
    setStatusBarLyricText: noop,
    setStatusBarLyricTop: noop,
    setStatusBarLyricLeft: noop,
    setStatusBarLyricWidth: noop,
    setStatusBarLyricFontSize: noop,
    setStatusBarLyricAlign: noop,
    setStatusBarColors: noop,

    /**
     * 返回 true：让 basicSetting.tsx / musicItemLyricOptions.tsx 里的
     * "开启状态栏歌词"开关走成功分支，避免反复弹"请打开悬浮窗权限"的 toast。
     * iOS 上实际没有悬浮窗，所有 setter 都是 no-op，仅保证 UI 不报错。
     */
    checkSystemAlertPermission: async () => true,
    requestSystemAlertPermission: async () => true,
};

export default LyricUtil;
