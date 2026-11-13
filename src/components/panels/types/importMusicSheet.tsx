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
    PLATFORM_LABEL,
    extractUrls,
    parseSheetShareLink,
    type IParsedSheetLink,
} from "@/utils/parseSheetLink";
import {
    extractIdLocally,
    followRedirects,
    isShortLink,
} from "@/utils/resolveShortLink";

/** 按平台优先挑选插件 */
function pickPluginsForSheet(link: IParsedSheetLink) {
    const all = PluginManager.getSortedPluginsWithAbility("importMusicSheet");
    if (link.platform === "unknown") {
        return all;
    }
    const keyword = link.platform === "qq" ? ["qq"] : ["网易", "netease", "163"];
    const matched = all.filter(p => {
        const name = `${p.name ?? ""} ${p.instance?.platform ?? ""}`.toLowerCase();
        return keyword.some(k => name.includes(k.toLowerCase()));
    });
    return matched.length ? matched : all;
}

/**
 * 把一条分享链接解析成「可以喂给插件的候选值」列表。
 *
 * 插件（padao 系列）的 resolveSheetId 支持三种输入：
 *   1. 纯 id 数字        → 最稳，优先用
 *   2. 标准长链          → 次之
 *   3. 原始短链          → 插件自己处理不了（同步逻辑），仅兜底
 *
 * 所以这里依次尝试：本地提取 id → 跟随跳转再提取 → 原始 URL。
 */
async function buildCandidates(rawUrl: string): Promise<IParsedSheetLink & { values: string[] }> {
    const base = parseSheetShareLink(rawUrl) ?? {
        platform: "unknown" as const,
        id: null,
        normalizedUrl: rawUrl,
        rawUrl,
        rawText: rawUrl,
    };

    const values: string[] = [];
    const push = (v: string | null | undefined) => {
        const s = (v ?? "").trim();
        if (s && !values.includes(s)) {
            values.push(s);
        }
    };

    // 1) 本地提取
    const localId = extractIdLocally(rawUrl, base.platform);
    if (localId) {
        push(localId); // 纯数字 id 优先
        if (base.platform === "qq") {
            push(`https://y.qq.com/n/ryqq/playlist/${localId}`);
        } else if (base.platform === "netease") {
            push(`https://music.163.com/playlist?id=${localId}`);
        }
    }
    // 原始链接（保留 uct2 等参数）
    push(rawUrl);

    // 2) 短链：跟随跳转后再提取
    if (!localId && isShortLink(rawUrl)) {
        const finalUrl = await followRedirects(rawUrl);
        if (finalUrl && finalUrl !== rawUrl) {
            const id2 = extractIdLocally(finalUrl, base.platform);
            if (id2) {
                // 跳转拿到的 id 优先级最高，插到最前面
                values.unshift(id2);
                if (base.platform === "qq") {
                    values.unshift(`https://y.qq.com/n/ryqq/playlist/${id2}`);
                } else if (base.platform === "netease") {
                    values.unshift(`https://music.163.com/playlist?id=${id2}`);
                }
            }
            push(finalUrl);
        }
    }

    return {
        ...base,
        id: values.find(v => /^\d{4,}$/.test(v)) ?? base.id,
        values,
    };
}

export default function ImportMusicSheet() {
    const validPlugins = PluginManager.getSortedPluginsWithAbility("importMusicSheet");
    const { t } = useI18N();
    const safeAreaInsets = useSafeAreaInsets();

    const [clipLinks, setClipLinks] = useState<IParsedSheetLink[]>([]);
    const [clipText, setClipText] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const text = (await Clipboard.getString()) || "";
                if (cancelled || !text) {
                    return;
                }
                setClipText(text);
                const urls = extractUrls(text);
                const parsed: IParsedSheetLink[] = [];
                for (const u of urls) {
                    const p = parseSheetShareLink(u);
                    if (p) {
                        parsed.push(p);
                    }
                }
                if (parsed.length) {
                    setClipLinks(parsed);
                }
            } catch {
                // 剪贴板不可用
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    /** 统一导入流程 */
    const runImport = async (plugin: any, text: string, closePanel: () => void) => {
        if (!plugin) {
            Toast.warn("还没有可用音源插件，请先在「插件管理 → 一键安装内置音源」");
            return;
        }

        const urls = extractUrls(text);
        if (!urls.length) {
            // 用户可能直接粘了纯数字 id
            const digits = text.trim();
            if (/^\d{4,}$/.test(digits)) {
                urls.push(digits);
            } else {
                Toast.warn("没有识别到链接，请粘贴 QQ音乐/网易云 的分享链接");
                return;
            }
        }

        closePanel();
        Toast.success(t("panel.importMusicSheet.importing"));

        let okCount = 0;
        let lastError = "";

        for (const rawUrl of urls) {
            const enriched = await buildCandidates(rawUrl);
            const candidates = pickPluginsForSheet(enriched);
            const ordered = [
                plugin,
                ...candidates.filter((c: any) => c.hash !== plugin.hash),
            ];

            let imported = false;

            // 依次尝试每个插件的每个候选值
            outer: for (const candidate of ordered) {
                for (const value of enriched.values) {
                    try {
                        const result = await candidate.methods.importMusicSheet(value);
                        if (result && result.length > 0) {
                            imported = true;
                            okCount++;
                            showDialog("SimpleDialog", {
                                title: t("panel.importMusicSheet.prepareImport"),
                                content: `${
                                    PLATFORM_LABEL[enriched.platform]
                                } ${t("panel.importMusicSheet.foundSongs", {
                                    count: result.length,
                                })}`,
                                onOk() {
                                    showPanel("AddToMusicSheet", {
                                        musicItem: result,
                                    });
                                },
                            });
                            break outer;
                        }
                    } catch (e: any) {
                        lastError = e?.message ?? "";
                    }
                }
            }

            if (!imported) {
                Toast.warn(
                    `${PLATFORM_LABEL[enriched.platform]}：${
                        lastError ||
                        t("panel.importMusicSheet.invalidLink")
                    }`,
                );
            }
        }

        if (okCount === 0 && urls.length) {
            // 全部失败时给一次更明确的提示
            Toast.warn("导入失败：请确认链接有效，或在插件管理里换一个音源插件试试");
        }
    };

    const openInput = (plugin: any, prefill?: string) => {
        showPanel("SimpleInput", {
            title: t("panel.importMusicSheet.title"),
            placeholder: "粘贴歌单分享链接或歌单ID",
            hints: plugin?.instance?.hints?.importMusicSheet,
            maxLength: 2000,
            defaultValue: prefill ?? "",
            async onOk(text, closePanel) {
                await runImport(plugin, text, closePanel);
            },
        });
    };

    const firstPlugin = validPlugins[0] ?? null;

    return (
        <PanelBase
            height={vmax(66)}
            renderBody={() => (
                <>
                    <PanelHeader hideButtons title={t("panel.importMusicSheet.title")} />

                    <View style={{ paddingHorizontal: rpx(24) }}>
                        <ThemeText
                            fontColor="textSecondary"
                            fontSize="subTitle"
                            style={{ paddingVertical: rpx(10) }}>
                            支持 QQ音乐 / 网易云音乐 的歌单链接、分享文案，或直接输入歌单 ID
                        </ThemeText>
                    </View>

                    {clipLinks.length ? (
                        <View style={{ paddingHorizontal: rpx(24), paddingBottom: rpx(8) }}>
                            <ThemeText fontSize="subTitle" style={{ paddingVertical: rpx(8) }}>
                                检测到剪贴板：
                            </ThemeText>
                            {clipLinks.map(link => (
                                <ListItem
                                    key={link.normalizedUrl}
                                    withHorizontalPadding
                                    onPress={() => {
                                        openInput(firstPlugin, link.rawUrl);
                                    }}>
                                    <ListItem.Content
                                        title={`导入 ${PLATFORM_LABEL[link.platform]}${
                                            link.id ? `（${link.id}）` : ""
                                        }`}
                                    />
                                </ListItem>
                            ))}
                        </View>
                    ) : null}

                    <ListItem
                        withHorizontalPadding
                        onPress={() => {
                            if (!firstPlugin) {
                                Toast.warn("还没有音源插件，请先「一键安装内置音源」");
                                return;
                            }
                            openInput(firstPlugin, clipText || undefined);
                        }}>
                        <ListItem.Content
                            title="手动粘贴歌单链接"
                            description={
                                validPlugins.length
                                    ? `将使用「${firstPlugin?.name}」解析`
                                    : "尚无音源插件"
                            }
                        />
                    </ListItem>

                    <View
                        style={{
                            height: 1,
                            backgroundColor: "#8884",
                            marginVertical: rpx(8),
                        }}
                    />

                    {validPlugins.length ? (
                        <View style={globalStyle.fwflex1}>
                            <ThemeText
                                fontColor="textSecondary"
                                fontSize="subTitle"
                                style={{ paddingHorizontal: rpx(24), paddingVertical: rpx(8) }}>
                                或选择指定插件：
                            </ThemeText>
                            <FlatList
                                data={validPlugins}
                                keyExtractor={(p: any) => p.hash}
                                style={{ marginBottom: safeAreaInsets.bottom }}
                                renderItem={({ item: p }: any) => (
                                    <ListItem
                                        withHorizontalPadding
                                        key={p.hash}
                                        onPress={() => openInput(p, clipText || undefined)}>
                                        <ListItem.Content title={p.name} />
                                    </ListItem>
                                )}
                            />
                        </View>
                    ) : (
                        <View style={{ paddingHorizontal: rpx(24), paddingTop: rpx(16) }}>
                            <ThemeText fontColor="textSecondary">
                                当前没有支持「导入歌单」的插件。{"\n"}
                                请到「设置 → 插件管理 → 一键安装内置音源」。
                            </ThemeText>
                        </View>
                    )}
                </>
            )}
        />
    );
}
