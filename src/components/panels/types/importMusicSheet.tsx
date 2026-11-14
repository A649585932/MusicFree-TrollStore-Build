import ListItem from "@/components/base/listItem";
import rpx, { vmax } from "@/utils/rpx";
import Toast from "@/utils/toast";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";

import { showDialog } from "@/components/dialogs/useDialog";
import globalStyle from "@/constants/globalStyle";
import PluginManager from "@/core/pluginManager";
import { FlatList } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import { showPanel } from "../usePanel";
import { useI18N } from "@/core/i18n";
import ThemeText from "@/components/base/themeText";
import {
    detectSource,
    extractNeteaseId,
    extractQQId,
    importSheetDirect,
    type SheetSource,
} from "@/core/sheetImporter";
import { extractUrls } from "@/utils/parseSheetLink";
import { followRedirects, isShortLink } from "@/utils/resolveShortLink";

const SOURCE_LABEL: Record<SheetSource, string> = {
    netease: "网易云音乐",
    qq: "QQ音乐",
    unknown: "其他",
};

/**
 * 把用户输入整理成「平台 + 可用 id」。
 *
 * QQ 分享出来的是短链（c6.y.qq.com/base/fcgi-bin/u?__=xxx），
 * 里面没有 id，必须跟一次 302 才能拿到。
 */
async function resolveInput(rawInput: string): Promise<{
    source: SheetSource;
    value: string;
    display: string;
}> {
    const input = (rawInput ?? "").trim();

    // 纯数字：平台未知，交给调用方猜
    if (/^\d{4,}$/.test(input)) {
        return { source: "unknown", value: input, display: input };
    }

    let source = detectSource(input);
    let url = input;

    // 短链：先跟跳转
    if (isShortLink(input)) {
        const finalUrl = await followRedirects(input);
        if (finalUrl && finalUrl !== input) {
            url = finalUrl;
            const s2 = detectSource(finalUrl);
            if (s2 !== "unknown") {
                source = s2;
            }
        }
    }

    return { source, value: url, display: url };
}

export default function ImportMusicSheet() {
    const { t } = useI18N();
    const safeAreaInsets = useSafeAreaInsets();
    const [busy, setBusy] = useState(false);
    const [clipText, setClipText] = useState("");
    const [clipInfo, setClipInfo] = useState<{
        source: SheetSource;
        label: string;
    } | null>(null);

    const plugins = PluginManager.getSortedPlugins();

    /**
     * 把「平台标识」映射成「插件名」。
     *
     * 为什么必须这么做：
     *   PluginManager.getByName() 内部是
     *       this.getPlugins().find(_ => _.name === name)
     *   ——按插件名**精确匹配**。
     *   而插件的 name 是中文（如「QQ音乐」），
     *   如果我们把 platform 写成 "qq"，播放时 getByName("qq") 返回 undefined，
     *   拿不到 getMediaSource → 无 url → 播放器疯狂跳下一首。
     *
     * 所以导入时必须把 platform 设成插件的真实 name。
     */
    const resolvePluginName = (
        source: SheetSource,
        preferred?: any,
    ): string => {
        // 1) 用户点选的那个插件，直接用它的名字
        if (preferred?.name) {
            return preferred.name;
        }

        const kw =
            source === "qq"
                ? ["qq"]
                : source === "netease"
                  ? ["网易", "netease", "163"]
                  : [];

        // 2) srcUrl 文件名匹配：qq-source.plugin.v1.9.26.js → qq
        if (kw.length) {
            for (const p of plugins) {
                const srcUrl = `${(p as any).instance?.srcUrl ?? ""}`.toLowerCase();
                const file = srcUrl.split("/").pop() ?? "";
                for (const k of kw) {
                    if (file.includes(k)) {
                        return p.name;
                    }
                }
            }

            // 3) 插件名包含匹配（「QQ音乐」含 "qq"）
            for (const p of plugins) {
                const name = `${p.name ?? ""}`.toLowerCase();
                for (const k of kw) {
                    if (name.includes(k)) {
                        return p.name;
                    }
                }
            }

            // 4) instance.platform 字段匹配
            for (const p of plugins) {
                const plat = `${(p as any).instance?.platform ?? ""}`.toLowerCase();
                for (const k of kw) {
                    if (plat === k || plat.includes(k)) {
                        return p.name;
                    }
                }
            }
        }

        // 5) 兜底：第一个可用插件（保证至少能播放）
        if (plugins.length) {
            return plugins[0].name;
        }

        // 完全没有插件，返回平台标识（会播放失败，但至少不崩）
        return source;
    };

    // 打开面板时读剪贴板，识别平台
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const text = (await Clipboard.getString()) || "";
                if (cancelled || !text) {
                    return;
                }
                const urls = extractUrls(text);
                const target = urls[0] ?? text.trim();
                const src = detectSource(target);
                setClipText(text.trim());
                setClipInfo({
                    source: src,
                    label: src === "unknown" ? "未知平台" : SOURCE_LABEL[src],
                });
            } catch {
                /* 剪贴板不可用 */
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * 核心导入：优先用 App 自实现的接口（插件已失效），
     * 失败再退回插件。
     */
    const doImport = async (
        text: string,
        preferred?: SheetSource,
        preferredPlugin?: any,
    ) => {
        if (busy) {
            return;
        }
        setBusy(true);
        try {
            const resolved = await resolveInput(text);
            const source =
                resolved.source !== "unknown"
                    ? resolved.source
                    : preferred ?? "netease";

            Toast.success(`正在解析${SOURCE_LABEL[source]}歌单…`);

            // 1) 走自研接口
            let result;
            try {
                result = await importSheetDirect(resolved.value, source);
            } catch (e: any) {
                // 2) 自研失败 → 退回插件（万一插件修好了）
                const plugin = plugins[0];
                if (plugin && typeof plugin.methods?.importMusicSheet === "function") {
                    try {
                        const items = await plugin.methods.importMusicSheet(
                            resolved.value,
                        );
                        if (items && items.length) {
                            showDialog("SimpleDialog", {
                                title: t("panel.importMusicSheet.prepareImport"),
                                content: `${SOURCE_LABEL[source]} 找到 ${items.length} 首`,
                                onOk() {
                                    showPanel("AddToMusicSheet", { musicItem: items });
                                },
                            });
                            return;
                        }
                    } catch {
                        /* 插件也失败，用自研的错误信息 */
                    }
                }
                throw e;
            }

            if (!result.songs.length) {
                Toast.warn("歌单是空的，可能已被删除或设为私密");
                return;
            }

            showDialog("SimpleDialog", {
                title: t("panel.importMusicSheet.prepareImport"),
                content: `《${result.sheetName}》共 ${result.songs.length} 首，导入到新歌单？`,
                onOk() {
                    /**
                     * 关键：platform 必须是「插件名」，不是平台标识。
                     *
                     * PluginManager.getByName() 用 `_.name === name` 精确匹配，
                     * 插件的 name 是中文名（如「QQ音乐」），
                     * 所以这里要把 platform 设成插件名，
                     * 否则播放时找不到插件 → 拿不到 url → 无限跳下一首。
                     */
                    const pluginName = resolvePluginName(result!.source, preferredPlugin);
                    const items = result!.songs.map(s => ({
                        id: s.id,
                        platform: pluginName,
                        title: s.title,
                        artist: s.artist,
                        album: s.album,
                        duration: s.duration,
                        artwork: s.artwork,
                    }));
                    showPanel("AddToMusicSheet", { musicItem: items });
                },
            });
        } catch (e: any) {
            Toast.warn(`导入失败：${e?.message ?? e}`);
        } finally {
            setBusy(false);
        }
    };

    const openInput = (prefill?: string, plugin?: any) => {
        showPanel("SimpleInput", {
            title: "导入歌单",
            placeholder: "粘贴 QQ音乐/网易云 歌单链接或歌单 ID",
            maxLength: 2000,
            defaultValue: prefill ?? "",
            onOk: async (text, closePanel) => {
                closePanel();
                await doImport(text, undefined, plugin);
            },
        } as any);
    };

    return (
        <PanelBase
            height={vmax(66)}
            renderBody={() => (
                <>
                    <PanelHeader hideButtons title="导入歌单" />

                    <View style={{ paddingHorizontal: rpx(24) }}>
                        <ThemeText
                            fontColor="textSecondary"
                            fontSize="subTitle"
                            style={{ paddingVertical: rpx(10) }}>
                            支持 QQ音乐 / 网易云音乐 歌单链接、分享文案或歌单 ID
                        </ThemeText>
                    </View>

                    {/* 剪贴板一键导入 */}
                    {clipText ? (
                        <ListItem
                            withHorizontalPadding
                            onPress={() => {
                                if (clipInfo && clipInfo.source === "unknown") {
                                    openInput(clipText);
                                } else {
                                    doImport(clipText, clipInfo?.source);
                                }
                            }}>
                            <ListItem.Content
                                title={`从剪贴板导入${clipInfo ? `（${clipInfo.label}）` : ""}`}
                                description={
                                    clipText.length > 40
                                        ? clipText.slice(0, 40) + "…"
                                        : clipText
                                }
                            />
                        </ListItem>
                    ) : null}

                    {/* 手动输入 */}
                    <ListItem
                        withHorizontalPadding
                        onPress={() => openInput(clipText || undefined)}>
                        <ListItem.Content
                            title="手动粘贴歌单链接"
                            description="支持短链、分享文案、歌单 ID"
                        />
                    </ListItem>

                    <View
                        style={{
                            height: 1,
                            backgroundColor: "#8884",
                            marginVertical: rpx(8),
                        }}
                    />

                    {/* 平台快捷入口 */}
                    <ThemeText
                        fontColor="textSecondary"
                        fontSize="subTitle"
                        style={{ paddingHorizontal: rpx(24), paddingVertical: rpx(8) }}>
                        指定平台直接输入 ID：
                    </ThemeText>
                    <View style={globalStyle.fwflex1}>
                        <FlatList
                            data={[
                                { key: "qq", label: "QQ音乐" },
                                { key: "netease", label: "网易云音乐" },
                            ]}
                            keyExtractor={(i: any) => i.key}
                            style={{ marginBottom: safeAreaInsets.bottom }}
                            renderItem={({ item }: any) => (
                                <ListItem
                                    withHorizontalPadding
                                    onPress={() => {
                                        // 让用户只输 ID
                                        showPanel("SimpleInput", {
                                            title: `${item.label} 歌单 ID`,
                                            placeholder: "只填数字，例如 365054063",
                                            maxLength: 32,
                                            onOk: async (text: string, close: () => void) => {
                                                close();
                                                await doImport(text.trim(), item.key);
                                            },
                                        } as any);
                                    }}>
                                    <ListItem.Content
                                        title={item.label}
                                        description="输入纯数字歌单 ID"
                                    />
                                </ListItem>
                            )}
                        />
                    </View>
                </>
            )}
        />
    );
}
