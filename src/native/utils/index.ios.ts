/**
 * iOS / TrollStore 版 NativeUtils
 *
 * 原工程 src/native/utils/index.ts 直接取 NativeModules.NativeUtils，
 * 但这个原生模块只有 Android 实现（android/app/src/main/java/.../NativeUtils）。
 * iOS 上 NativeModules.NativeUtils === undefined，任何调用都会抛
 * "Cannot read property 'xxx' of undefined"，其中 getWindowDimensions()
 * 在面板渲染时同步调用，会直接导致红屏。
 *
 * Metro 目录解析规则：import "@/native/utils" 时优先命中 index.ios.ts，
 * 所以这里提供一个 API 完全一致的纯 JS 降级实现，Android 行为保持不变。
 */
import { Dimensions } from "react-native";

export interface INativeUtils {
    exitApp: () => void;
    checkStoragePermission: () => Promise<boolean>;
    requestStoragePermission: () => void;
    getWindowDimensions: () => { width: number; height: number };
}

const NativeUtils: INativeUtils = {
    /**
     * iOS 没有公开的"杀掉自己"API（UIApplication 主动 exit 属于私有接口，
     * App Store 会拒，TrollStore 下可自行用原生 exit(0) 替换）。
     * 这里降级为无操作，配合侧边栏"退出应用"按钮不会崩。
     * 想真正退出：在 AppDelegate.mm 里加 RCT_EXPORT_METHOD(exitApp) { exit(0); }
     */
    exitApp: () => {
        // 尝试唤起一个无效 URL 让系统把 App 压到后台是不可靠的，保持 no-op。
        // 用 Linking 打开设置页作为"有反馈"的兜底也不合适，故仅记录日志。
        if (__DEV__) {
            console.log("[iOS] exitApp() is a no-op; use the Home gesture instead.");
        }
    },

    /** iOS 沙盒内 Documents/ 天然可读写，无需 Android 的 MANAGE_EXTERNAL_STORAGE */
    checkStoragePermission: async () => true,

    /** iOS 无对应权限弹窗，no-op */
    requestStoragePermission: () => {},

    /** 替代 Android 原生 getWindowDimensions，用于 panelBase.tsx 的定位计算 */
    getWindowDimensions: () => {
        const { width, height } = Dimensions.get("window");
        return { width, height };
    },
};

export default NativeUtils;
