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
    parseMultipleSheetLinks,
    type IParsedSheetLink,
} from "@/utils/parseSheetLink";

/** 按平台优先挑选插件：QQ 歌单优先 QQ 系插件，网易云优先网易云系插件 */
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
                const parsed = parseMultipleSheetLinks(text);
                if (parsed.length) {
                    setClipLinks(parsed);
                }
            } catch {
                // 剪贴板不可用就跳过
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    /** 统一导入流程：解析 → 调插件 → 成功后确认加入歌单 */
    const runImport = async (plugin: any, text: string, closePanel: () => void) => {
        const shareLinks = parseMultipleSheetLinks(text);
        if (!shareLinks.length) {
            // 剪贴板里可能是插件订阅、单曲链接等，给出更精确的提示
            Toast.warn("没有识别到歌单链接，请粘贴 QQ音乐/网易云 的分享链接");
            return;
        }

        closePanel();
        Toast.success(t("panel.importMusicSheet.importing"));

        for (const link of shareLinks) {
            if (!plugin) {
                Toast.warn("还没有可用音源插件，请先在「插件管理」里订阅");
                return;
            }
            const candidates = pickPluginsForSheet(link);
            const ordered = [
                plugin,
                ...candidates.filter(c => c.hash !== plugin.hash),
            ];

            let imported = false;
            for (const candidate of ordered) {
                try {
                    const result = await candidate.methods.importMusicSheet(
                        link.normalizedUrl,
                    );
                    if (result && result.length > 0) {
                        imported = true;
                        showDialog("SimpleDialog", {
                            title: t("panel.importMusicSheet.prepareImport"),
                            content: `${
                                PLATFORM_LABEL[link.platform]
                            } ${t("panel.importMusicSheet.foundSongs", {
                                count: result.length,
                            })}`,
                            onOk() {
                                showPanel("AddToMusicSheet", {
                                    musicItem: result,
                                });
                            },
                        });
                        break;
                    }
                } catch {
                    // 换下一个插件
                }
            }

            if (!imported) {
                Toast.warn(
                    `${PLATFORM_LABEL[link.platform]}：${t(
                        "panel.importMusicSheet.invalidLink",
                    )}`,
                );
            }
        }
    };

    const openInput = (plugin: any, prefill?: string) => {
        showPanel("SimpleInput", {
            title: t("panel.importMusicSheet.title"),
            placeholder: "粘贴歌单分享链接，如 https://music.163.com/playlist?id=xxx",
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
                            支持 QQ音乐 / 网易云音乐 的歌单分享链接或分享文案
                        </ThemeText>
                    </View>

                    {/* 从剪贴板一键导入：最显眼的位置 */}
                    {clipLinks.length ? (
                        <View
                            style={{
                                paddingHorizontal: rpx(24),
                                paddingBottom: rpx(8),
                            }}>
                            <ThemeText
                                fontSize="subTitle"
                                style={{ paddingVertical: rpx(8) }}>
                                检测到剪贴板内容：
                            </ThemeText>
                            {clipLinks.map(link => (
                                <ListItem
                                    key={link.normalizedUrl}
                                    withHorizontalPadding
                                    onPress={() => {
                                        openInput(
                                            firstPlugin,
                                            link.rawText || link.normalizedUrl,
                                        );
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

                    {/* 手动粘贴入口：始终存在，不依赖插件是否支持 importMusicSheet */}
                    <ListItem
                        withHorizontalPadding
                        onPress={() => {
                            if (!firstPlugin) {
                                Toast.warn(
                                    "还没有音源插件，请先去「设置 → 插件管理」订阅",
                                );
                                return;
                            }
                            openInput(firstPlugin, clipText || undefined);
                        }}>
                        <ListItem.Content
                            title="手动粘贴歌单链接"
                            description={
                                validPlugins.length
                                    ? `将使用「${firstPlugin?.name}」解析`
                                    : "尚无音源插件，请先订阅"
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
                                或选择指定插件解析：
                            </ThemeText>
                            <FlatList
                                data={validPlugins}
                                keyExtractor={plugin => plugin.hash}
                                style={{ marginBottom: safeAreaInsets.bottom }}
                                renderItem={({ item: plugin }) => (
                                    <ListItem
                                        withHorizontalPadding
                                        key={`${plugin.hash}`}
                                        onPress={() =>
                                            openInput(plugin, clipText || undefined)
                                        }>
                                        <ListItem.Content title={plugin.name} />
                                    </ListItem>
                                )}
                            />
                        </View>
                    ) : (
                        <View
                            style={{
                                paddingHorizontal: rpx(24),
                                paddingTop: rpx(16),
                            }}>
                            <ThemeText fontColor="textSecondary">
                                当前没有支持「导入歌单」的插件。{"\n"}
                                请到「设置 → 插件管理 → 订阅插件」添加音源后重试。
                            </ThemeText>
                        </View>
                    )}
                </>
            )}
        />
    );
}
