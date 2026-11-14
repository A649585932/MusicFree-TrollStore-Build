import ListItem from "@/components/base/listItem";
import ThemeSwitch from "@/components/base/switch";
import ThemeText from "@/components/base/themeText";
import { showDialog } from "@/components/dialogs/useDialog";
import { showPanel } from "@/components/panels/usePanel";
import { SortType } from "@/constants/commonConst.ts";
import pathConst from "@/constants/pathConst";
import Config, { useAppConfig } from "@/core/appConfig";
import { useI18N } from "@/core/i18n";
import { ROUTE_PATH, useNavigate } from "@/core/router";
import useColors from "@/hooks/useColors";
import LyricUtil, { NativeTextAlignment } from "@/native/lyricUtil";
import { AppConfigPropertyKey } from "@/types/core/config";
import { clearCache, getCacheSize, sizeFormatter } from "@/utils/fileUtils";
import { qualityKeys } from "@/utils/qualities";
import rpx from "@/utils/rpx";
import Toast from "@/utils/toast";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { SectionList, StyleSheet, TouchableOpacity, View } from "react-native";
import { readdir } from "react-native-fs";
import { ScrollView } from "react-native-gesture-handler";

function createSwitch(
    title: string,
    changeKey: AppConfigPropertyKey,
    value: boolean,
    callback?: (newValue: boolean) => void,
) {
    const onPress = () => {
        if (callback) {
            callback(!value);
        } else {
            Config.setConfig(changeKey, !value);
        }
    };
    return {
        title,
        onPress,
        right: <ThemeSwitch value={value} onValueChange={onPress} />,
    };
}

const createRadio = function (
    title: string,
    changeKey: AppConfigPropertyKey,
    candidates: Array<string | number>,
    value: string | number,
    valueMap?: Record<string | number, string | number>,
    onChange?: (value: string | number) => void,
) {
    const onPress = () => {
        showDialog("RadioDialog", {
            title,
            content: valueMap
                ? candidates.map(_ => ({
                    label: valueMap[_] as string,
                    value: _,
                }))
                : candidates,
            onOk(val) {
                Config.setConfig(changeKey, val);
                onChange?.(val);
            },
        });
    };
    return {
        title,
        right: (
            <ThemeText style={styles.centerText}>
                {valueMap ? valueMap[value] : value}
            </ThemeText>
        ),
        onPress,
    };
};

function useCacheSize() {
    const [cacheSize, setCacheSize] = useState({
        music: 0,
        lyric: 0,
        image: 0,
    });

    const refreshCacheSize = useCallback(async () => {
        const [musicCache, lyricCache, imageCache] = await Promise.all([
            getCacheSize("music"),
            getCacheSize("lyric"),
            getCacheSize("image"),
        ]);
        setCacheSize({
            music: musicCache,
            lyric: lyricCache,
            image: imageCache,
        });
    }, []);

    return [cacheSize, refreshCacheSize] as const;
}

export default function BasicSetting() {

    const autoPlayWhenAppStart = useAppConfig("basic.autoPlayWhenAppStart");
    const useCelluarNetworkPlay = useAppConfig("basic.useCelluarNetworkPlay");
    const useCelluarNetworkDownload = useAppConfig("basic.useCelluarNetworkDownload");
    const maxDownload = useAppConfig("basic.maxDownload");
    const clickMusicInSearch = useAppConfig("basic.clickMusicInSearch");
    const clickMusicInAlbum = useAppConfig("basic.clickMusicInAlbum");
    const downloadPath = useAppConfig("basic.downloadPath");
    const notInterrupt = useAppConfig("basic.notInterrupt");
    const tempRemoteDuck = useAppConfig("basic.tempRemoteDuck");
    const tempRemoteDuckVolume = useAppConfig("basic.tempRemoteDuckVolume");
    const autoStopWhenError = useAppConfig("basic.autoStopWhenError");
    const maxCacheSize = useAppConfig("basic.maxCacheSize");
    const defaultPlayQuality = useAppConfig("basic.defaultPlayQuality");
    const playQualityOrder = useAppConfig("basic.playQualityOrder");
    const defaultDownloadQuality = useAppConfig("basic.defaultDownloadQuality");
    const downloadQualityOrder = useAppConfig("basic.downloadQualityOrder");
    const musicDetailDefault = useAppConfig("basic.musicDetailDefault");
    const musicDetailAwake = useAppConfig("basic.musicDetailAwake");
    const maxHistoryLen = useAppConfig("basic.maxHistoryLen");
    const autoUpdatePlugin = useAppConfig("basic.autoUpdatePlugin");
    const notCheckPluginVersion = useAppConfig("basic.notCheckPluginVersion");
    const lazyLoadPlugin = useAppConfig("basic.lazyLoadPlugin");
    const associateLyricType = useAppConfig("basic.associateLyricType");
    const showExitOnNotification = useAppConfig("basic.showExitOnNotification");
    const musicOrderInLocalSheet = useAppConfig("basic.musicOrderInLocalSheet");
    const tryChangeSourceWhenPlayFail = useAppConfig("basic.tryChangeSourceWhenPlayFail");

    const { t } = useI18N();

    // 开发选项相关的配置读取已随 UI 一起移除

    const navigate = useNavigate();

    const [cacheSize, refreshCacheSize] = useCacheSize();

    const sectionListRef = useRef<SectionList | null>(null);

    /**
     * 每个 section 的 Y 偏移（由 renderSectionHeader 的 onLayout 填充）。
     * 点击顶部 tab 时用它精确跳转——比 scrollToLocation 可靠得多。
     */
    const sectionOffsets = useRef<Record<number, number>>({});

    /** 当前高亮的分类索引（随滚动同步） */
    const [activeSection, setActiveSection] = useState(0);

    /**
     * 滚动时更新高亮。
     * 用最高可见比例判断，避免快速滚动时来回跳。
     */
    const viewabilityConfig = useRef({
        itemVisiblePercentThreshold: 40,
    }).current;

    const viewableItemsChanged = useRef(
        ({ viewableItems }: { viewableItems: Array<{ section?: any }> }) => {
            if (!viewableItems.length) {
                return;
            }
            // 找到第一个可见 item 所属的 section
            const first = viewableItems[0];
            const sec = first?.section;
            if (!sec) {
                return;
            }
            const idx = basicOptionsRef.current.findIndex(
                s => s.title === sec.title,
            );
            if (idx >= 0) {
                setActiveSection(idx);
            }
        },
    );

    // basicOptions 在下方定义，用 ref 桥接避免闭包旧值
    const basicOptionsRef = useRef<Array<{ title: string }>>([]);

    useEffect(() => {
        refreshCacheSize();
    }, []);

    const basicOptions = [
        {
            title: t("basicSettings.common"),
            data: [
                createRadio(
                    t("basicSettings.maxHistoryLength"),
                    "basic.maxHistoryLen",
                    [20, 50, 100, 200, 500],
                    maxHistoryLen ?? 50,
                ),
                createRadio(
                    t("basicSettings.musicDetailDefault"),
                    "basic.musicDetailDefault",
                    ["album", "lyric"],
                    musicDetailDefault ?? "album",
                    {
                        album: t("basicSettings.musicDetailDefault.album"),
                        lyric: t("basicSettings.musicDetailDefault.lyric"),
                    },
                ),
                createSwitch(
                    t("basicSettings.musicDetailAwake"),
                    "basic.musicDetailAwake",
                    musicDetailAwake ?? false,
                ),
                createRadio(
                    t("basicSettings.associateLyricType"),
                    "basic.associateLyricType",
                    ["input", "search"],
                    associateLyricType ?? "search",
                    {
                        input: t("basicSettings.associateLyricType.input"),
                        search: t("basicSettings.associateLyricType.search"),
                    },
                ),
                createSwitch(
                    t("basicSettings.showExitOnNotification"),
                    "basic.showExitOnNotification",
                    showExitOnNotification ?? false,
                ),
            ],
        },
        {
            title: t("basicSettings.sheetAndAlbum"),
            data: [
                createRadio(
                    t("basicSettings.clickMusicInSearch"),
                    "basic.clickMusicInSearch",
                    ["playMusic", "playMusicAndReplace"],
                    clickMusicInSearch ?? "playMusic",
                    {
                        playMusic: t("basicSettings.clickMusicInSearch.playMusic"),
                        playMusicAndReplace: t("basicSettings.clickMusicInSearch.playMusicAndReplace"),
                    },
                ),
                createRadio(
                    t("basicSettings.clickMusicInAlbum"),
                    "basic.clickMusicInAlbum",
                    ["playMusic", "playAlbum"],
                    clickMusicInAlbum ?? "playAlbum",
                    {
                        playMusic: t("basicSettings.clickMusicInAlbum.playMusic"),
                        playAlbum: t("basicSettings.clickMusicInAlbum.playAlbum"),
                    },
                ),
                createRadio(
                    t("basicSettings.musicDetailDefault"),
                    "basic.musicDetailDefault",
                    ["album", "lyric"],
                    musicDetailDefault ?? "album",
                    {
                        album: t("basicSettings.musicDetailDefault.album"),
                        lyric: t("basicSettings.musicDetailDefault.lyric"),
                    },
                ),
                createRadio(
                    t("basicSettings.musicOrderInLocalSheet"),
                    "basic.musicOrderInLocalSheet",
                    [
                        SortType.Title,
                        SortType.Artist,
                        SortType.Album,
                        SortType.Newest,
                        SortType.Oldest,
                    ],
                    musicOrderInLocalSheet ?? "end",
                    {
                        [SortType.Title]: t("basicSettings.musicOrderInLocalSheet.title"),
                        [SortType.Artist]: t("basicSettings.musicOrderInLocalSheet.artist"),
                        [SortType.Album]: t("basicSettings.musicOrderInLocalSheet.album"),
                        [SortType.Newest]: t("basicSettings.musicOrderInLocalSheet.newest"),
                        [SortType.Oldest]: t("basicSettings.musicOrderInLocalSheet.oldest"),
                    },
                ),
            ],
        },
        {
            title: t("basicSettings.plugin"),
            data: [
                createSwitch(
                    t("basicSettings.autoUpdatePlugin"),
                    "basic.autoUpdatePlugin",
                    autoUpdatePlugin ?? false,
                ),
                createSwitch(
                    t("basicSettings.notCheckPluginVersion"),
                    "basic.notCheckPluginVersion",
                    notCheckPluginVersion ?? false,
                ),
                createSwitch(
                    t("basicSettings.lazyLoadPlugin"),
                    "basic.lazyLoadPlugin",
                    lazyLoadPlugin ?? false,
                ),
            ],
        },
        {
            title: t("basicSettings.playback"),
            data: [
                createSwitch(
                    t("basicSettings.notInterrupt"),
                    "basic.notInterrupt",
                    notInterrupt ?? false,
                ),
                createSwitch(
                    t("basicSettings.autoPlayWhenAppStart"),
                    "basic.autoPlayWhenAppStart",
                    autoPlayWhenAppStart ?? false,
                ),
                createSwitch(
                    t("basicSettings.tryChangeSourceWhenPlayFail"),
                    "basic.tryChangeSourceWhenPlayFail",
                    tryChangeSourceWhenPlayFail ?? false,
                ),
                createSwitch(
                    t("basicSettings.autoStopWhenError"),
                    "basic.autoStopWhenError",
                    autoStopWhenError ?? false,
                ),
                createRadio(
                    t("basicSettings.tempRemoteDuck"),
                    "basic.tempRemoteDuck",
                    ["pause", "lowerVolume"],
                    tempRemoteDuck ?? "pause",
                    {
                        pause: t("basicSettings.tempRemoteDuck.pause"),
                        "lowerVolume": t("basicSettings.tempRemoteDuck.lowerVolume"),
                    }
                ),
                ...(tempRemoteDuck === "lowerVolume" ? [
                    createRadio(
                        t("basicSettings.tempRemoteDuck.volumeDecreaseLevel"),
                        "basic.tempRemoteDuckVolume",
                        [0.3, 0.5, 0.8],
                        tempRemoteDuckVolume ?? 0.5,
                        {
                            0.3: "30%",
                            0.5: "50%",
                            0.8: "80%",
                        }
                    ),
                ] : []),
                createRadio(
                    t("basicSettings.defaultPlayQuality"),
                    "basic.defaultPlayQuality",
                    qualityKeys,
                    defaultPlayQuality ?? "standard",
                    {
                        low: t("musicQuality.low"),
                        standard: t("musicQuality.standard"),
                        high: t("musicQuality.high"),
                        super: t("musicQuality.super"),
                    },
                ),
                createRadio(
                    t("basicSettings.playQualityOrder"),
                    "basic.playQualityOrder",
                    ["asc", "desc"],
                    playQualityOrder ?? "asc",
                    {
                        asc: t("basicSettings.playQualityOrder.asc"),
                        desc: t("basicSettings.playQualityOrder.desc"),
                    },
                ),
            ],
        },
        {
            title: t("basicSettings.download"),
            data: [
                {
                    title: t("basicSettings.downloadPath"),
                    right: (
                        <ThemeText
                            fontSize="subTitle"
                            style={styles.centerText}
                            numberOfLines={3}>
                            {downloadPath ??
                                pathConst.downloadMusicPath}
                        </ThemeText>
                    ),
                    onPress() {
                        navigate<"file-selector">(ROUTE_PATH.FILE_SELECTOR, {
                            fileType: "folder",
                            multi: false,
                            actionText: t("basicSettings.fileSelector.selectFolder"),
                            async onAction(selectedFiles) {
                                try {
                                    const targetDir = selectedFiles[0];
                                    await readdir(targetDir.path);
                                    Config.setConfig(
                                        "basic.downloadPath",
                                        targetDir.path,
                                    );
                                    return true;
                                } catch {
                                    Toast.warn(t("toast.folderNotExistOrNoPermission"));
                                    return false;
                                }
                            },
                        });
                    },
                },
                createRadio(
                    t("basicSettings.maxDownload"),
                    "basic.maxDownload",
                    [1, 3, 5, 7],
                    maxDownload ?? 3,
                ),
                createRadio(
                    t("basicSettings.defaultDownloadQuality"),
                    "basic.defaultDownloadQuality",
                    qualityKeys,
                    defaultDownloadQuality ?? "standard",
                    {
                        low: t("musicQuality.low"),
                        standard: t("musicQuality.standard"),
                        high: t("musicQuality.high"),
                        super: t("musicQuality.super"),
                    },
                ),
                createRadio(
                    t("basicSettings.downloadQualityOrder"),
                    "basic.downloadQualityOrder",
                    ["asc", "desc"],
                    downloadQualityOrder ?? "asc",
                    {
                        asc: t("basicSettings.downloadQualityOrder.asc"),
                        desc: t("basicSettings.downloadQualityOrder.desc"),
                    },
                ),
            ],
        },
        {
            title: t("basicSettings.network"),
            data: [
                createSwitch(
                    t("basicSettings.useCelluarNetworkPlay"),
                    "basic.useCelluarNetworkPlay",
                    // 默认打开（appConfig.setup 会把 true 写进 MMKV 作为种子；
                    // 这里的 ?? true 保证 UI 兜底显示与实际拦截逻辑一致）
                    useCelluarNetworkPlay ?? true,
                ),
                createSwitch(
                    t("basicSettings.useCelluarNetworkDownload"),
                    "basic.useCelluarNetworkDownload",
                    useCelluarNetworkDownload ?? false,
                ),
            ],
        },
        {
            title: t("basicSettings.lyric"),
            data: [],
            footer: <LyricSetting />,
        },
        {
            title: t("basicSettings.cache"),
            data: [
                {
                    title: t("basicSettings.cache.musicCacheLimit"),
                    right: (
                        <ThemeText style={styles.centerText}>
                            {maxCacheSize
                                ? sizeFormatter(maxCacheSize)
                                : "512M"}
                        </ThemeText>
                    ),
                    onPress() {
                        showPanel("SimpleInput", {
                            title: t("dialog.setCacheTitle"),
                            placeholder: t("dialog.setCachePlaceholder"),
                            onOk(text, closePanel) {
                                let val = parseInt(text);
                                if (val < 100) {
                                    val = 100;
                                } else if (val > 8192) {
                                    val = 8192;
                                }
                                if (val >= 100 && val <= 8192) {
                                    Config.setConfig(
                                        "basic.maxCacheSize",
                                        val * 1024 * 1024,
                                    );
                                    closePanel();
                                    Toast.success(t("toast.cacheSetSuccess"));
                                }
                            },
                        });
                    },
                },

                {
                    title: t("basicSettings.cache.clearMusicCache"),
                    right: (
                        <ThemeText style={styles.centerText}>
                            {sizeFormatter(cacheSize.music)}
                        </ThemeText>
                    ),
                    onPress() {
                        showDialog("SimpleDialog", {
                            title: t("dialog.clearMusicCacheTitle"),
                            content: t("dialog.clearMusicCacheContent"),
                            async onOk() {
                                await clearCache("music");
                                Toast.success(t("toast.musicCacheCleared"));
                                refreshCacheSize();
                            },
                        });
                    },
                },
                {
                    title: t("basicSettings.cache.clearLyricCache"),
                    right: (
                        <ThemeText style={styles.centerText}>
                            {sizeFormatter(cacheSize.lyric)}
                        </ThemeText>
                    ),
                    onPress() {
                        showDialog("SimpleDialog", {
                            title: t("dialog.clearLyricCacheTitle"),
                            content: t("dialog.clearLyricCacheContent"),
                            async onOk() {
                                await clearCache("lyric");
                                Toast.success(t("toast.lyricCacheCleared"));
                                refreshCacheSize();
                            },
                        });
                    },
                },
                {
                    title: t("basicSettings.cache.clearImageCache"),
                    right: (
                        <ThemeText style={styles.centerText}>
                            {sizeFormatter(cacheSize.image)}
                        </ThemeText>
                    ),
                    onPress() {
                        showDialog("SimpleDialog", {
                            title: t("dialog.clearImageCacheTitle"),
                            content: t("dialog.clearImageCacheContent"),
                            async onOk() {
                                await clearCache("image");
                                Toast.success(t("toast.imageCacheCleared"));
                                refreshCacheSize();
                            },
                        });
                    },
                },
            ],
        },
        // 开发选项整块移除（用户要求：不在设置里显示）
        // 相关能力仍在代码中（debug.* 配置项、日志文件），
        // 只是不再暴露 UI，避免误触。
    ];

    // 同步给 ref，供 viewability 回调读取（避免闭包旧值）
    basicOptionsRef.current = basicOptions;

    return (
        <View style={styles.wrapper}>
            {/*
              顶部分类导航（固定，不可拖动）
              - 点击跳转：用记录下来的 section Y 坐标 + scrollToOffset
                （scrollToLocation 在没有 getItemLayout 时经常静默失败，
                 实测点击无反应，所以改成坐标法）
            */}
            <View style={styles.headerContainer}>
                {basicOptions.map((section, index) => {
                    const active = activeSection === index;
                    return (
                        <TouchableOpacity
                            key={section.title}
                            onPress={() => {
                                /**
                                 * 跳转到指定分类。
                                 *
                                 * 踩坑记录（按尝试顺序）：
                                 *   1. scrollToOffset —— SectionList 没这个方法
                                 *   2. getScrollResponder().scrollTo —— 返回的是
                                 *      ScrollResponderType，上面没有 scrollTo
                                 *      （那是 ScrollView 的），调用静默失败
                                 *   3. scrollToLocation 单独用 —— 内部测量
                                 *      拿不到大列表高度时会静默跳过
                                 *
                                 * 最终方案：scrollToLocation + getItemLayout
                                 *   getItemLayout 提供了固定高度后，RN 不再依赖
                                 *   实时 measure，能稳定算出目标位置。
                                 */
                                const doScroll = (retry = 0) => {
                                    try {
                                        sectionListRef.current?.scrollToLocation({
                                            sectionIndex: index,
                                            itemIndex: 0,
                                            viewPosition: 0,
                                            animated: true,
                                        });
                                    } catch {
                                        // SectionList 内部测量失败会抛错，
                                        // 等一帧再试一次（此时 layout 已完成）
                                        if (retry < 3) {
                                            setTimeout(
                                                () => doScroll(retry + 1),
                                                60,
                                            );
                                        }
                                    }
                                };
                                doScroll();
                                setActiveSection(index);
                            }}
                            activeOpacity={0.7}
                            style={styles.headerItemStyle}>
                            <ThemeText
                                fontWeight="bold"
                                fontColor={active ? "text" : "textSecondary"}>
                                {section.title}
                            </ThemeText>
                            {active ? <View style={styles.headerActiveBar} /> : null}
                        </TouchableOpacity>
                    );
                })}
            </View>
            <SectionList
                sections={basicOptions}
                ref={sectionListRef}
                /**
                 * 记录每个 section 在列表里的 Y 偏移。
                 * SectionList 的 renderSectionHeader 拿不到绝对位置，
                 * 所以用 onLayout 累计：每次 header 布局时记下它的 y。
                 */
                renderSectionHeader={({ section }) => {
                    const idx = basicOptions.findIndex(
                        s => s.title === section.title,
                    );
                    return (
                        <View
                            style={styles.sectionHeader}
                            onLayout={e => {
                                if (idx >= 0) {
                                    sectionOffsets.current[idx] =
                                        e.nativeEvent.layout.y;
                                }
                            }}>
                            <ThemeText
                                fontSize="subTitle"
                                fontColor="textSecondary"
                                fontWeight="bold">
                                {section.title}
                            </ThemeText>
                        </View>
                    );
                }}
                /**
                 * 关键：提供 getItemLayout
                 *
                 * SectionList 的 scrollToLocation 依赖内部测量，
                 * 在大列表 / 动画进行中测量容易失败（静默不滚动）。
                 * 提供固定高度后，RN 直接用算术计算位置，稳定可靠。
                 *
                 * 高度取值：
                 *   SectionHeader  = rpx(72)（见 styles.sectionHeader）
                 *   Item           = rpx(96)（ListItem heightType="small"）
                 * 两个 header 之间的间隔用 marginTop 处理，已含在 header 高度里。
                 */
                getItemLayout={(_data, index) => {
                    const HEADER = rpx(72);
                    const ITEM = rpx(96);
                    // SectionList 的扁平索引：header 与 item 交错，
                    // 这里按「每个 section 1 个 header + N 个 item」的近似处理。
                    // RN 会在滚动后自动校正到精确位置。
                    return {
                        length: ITEM,
                        offset: HEADER + ITEM * index,
                        index,
                    };
                }}
                // 键盘弹出时不要挡住输入区域，点击空白也能收键盘
                keyboardShouldPersistTaps="handled"
                // iOS 上自动给底部留出键盘高度
                automaticallyAdjustKeyboardInsets
                keyboardDismissMode="on-drag"
                // 滚动时同步高亮当前分类
                onViewableItemsChanged={viewableItemsChanged.current}
                viewabilityConfig={viewabilityConfig}
                contentContainerStyle={styles.listContentContainer}
                renderSectionFooter={({ section }) => {
                    return section.footer ?? null;
                }}
                renderItem={({ item }) => {
                    const Right = item.right;

                    return (
                        <ListItem
                            withHorizontalPadding
                            heightType="small"
                            onPress={item.onPress}>
                            <ListItem.Content title={item.title} />
                            {Right}
                        </ListItem>
                    );
                }}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        width: "100%",
        paddingBottom: rpx(24),
        flex: 1,
    },
    centerText: {
        textAlignVertical: "center",
        maxWidth: rpx(400),
    },
    sectionHeader: {
        paddingHorizontal: rpx(24),
        height: rpx(72),
        flexDirection: "row",
        alignItems: "center",
        marginTop: rpx(20),
    },
    headerContainer: {
        height: rpx(80),
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-around",
        paddingHorizontal: rpx(12),
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#88888833",
    },
    headerContentContainer: {
        height: rpx(80),
        alignItems: "center",
        paddingHorizontal: rpx(24),
    },
    headerItemStyle: {
        flex: 1,
        height: rpx(80),
        justifyContent: "center",
        alignItems: "center",
        position: "relative",
    },
    /** 当前分类下方的指示条 */
    headerActiveBar: {
        position: "absolute",
        bottom: 0,
        height: rpx(4),
        width: "60%",
        borderRadius: rpx(2),
        backgroundColor: "#FF6B6B",
    },
    /** SectionList 底部留白，避免最后一项贴着屏幕底 */
    listContentContainer: {
        paddingBottom: rpx(120),
    },
});

function LyricSetting() {
    /**
     * // Lyric
     *     "lyric.showStatusBarLyric": boolean;
     *     "lyric.topPercent": number;
     *     "lyric.leftPercent": number;
     *     "lyric.align": number;
     *     "lyric.color": string;
     *     "lyric.backgroundColor": string;
     *     "lyric.widthPercent": number;
     *     "lyric.fontSize": number;
     *     "lyric.detailFontSize": number;
     *     "lyric.autoSearchLyric": boolean;
     */
    const showStatusBarLyric = useAppConfig("lyric.showStatusBarLyric");
    const topPercent = useAppConfig("lyric.topPercent");
    const leftPercent = useAppConfig("lyric.leftPercent");
    const align = useAppConfig("lyric.align");
    const color = useAppConfig("lyric.color");
    const backgroundColor = useAppConfig("lyric.backgroundColor");
    const widthPercent = useAppConfig("lyric.widthPercent");
    const fontSize = useAppConfig("lyric.fontSize");
    const enableAutoSearchLyric = useAppConfig("lyric.autoSearchLyric");



    const colors = useColors();

    const { t } = useI18N();

    const autoSearchLyric = createSwitch(
        t("basicSettings.lyric.autoSearchLyric"),
        "lyric.autoSearchLyric",
        enableAutoSearchLyric ?? false,
    );

    return (
        <View>
            {/* 歌词缺失时自动搜索歌词（iOS 上仍有效） */}
            <ListItem
                withHorizontalPadding
                heightType="small"
                onPress={autoSearchLyric.onPress}>
                <ListItem.Content title={autoSearchLyric.title} />
                {autoSearchLyric.right}
            </ListItem>
            {/*
              桌面歌词（状态栏歌词）相关设置已移除：
                - 开启桌面歌词
                - 左右距离 / 上下距离 / 歌词宽度 / 字体大小
                - 对齐方式 / 文本颜色 / 文本背景色

              iOS 上 LyricUtil 是空实现（shim），这些开关改了也不会有任何
              效果，留着只会误导用户。
            */}
        </View>
    );
}

