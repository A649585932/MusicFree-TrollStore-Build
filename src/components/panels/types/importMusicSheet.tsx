import ListItem from "@/components/base/listItem";
import rpx, { vmax } from "@/utils/rpx";
import Toast from "@/utils/toast";
import React, { useEffect, useState } from "react";
import { View } from "react-native";
import Clipboard from "@react-native-clipboard/clipboard";

import NoPlugin from "@/components/base/noPlugin";
import { showDialog } from "@/components/dialogs/useDialog";
import globalStyle from "@/constants/globalStyle";
import PluginManager from "@/core/pluginManager";
import { FlatList } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PanelBase from "../base/panelBase";
import PanelHeader from "../base/panelHeader";
import { showPanel } from "../usePanel";
import { useI18N } from "@/core/i18n";
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

    // 打开面板就尝试读剪贴板，识别到 QQ/网易云链接就直接提示
    const [clipLinks, setClipLinks] = useState<IParsedSheetLink[]>([]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const text = await Clipboard.getString();
                if (cancelled || !text) {
                    return;
                }
                const parsed = parseMultipleSheetLinks(text);
                if (!cancelled && parsed.length) {
                    setClipLinks(parsed);
                }
            } catch {
                // 剪贴板不可用就静默跳过
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    /**
     * 统一导入流程：解析分享文本 → 调插件 → 成功后确认加入歌单
     */
    const runImport = async (
        plugin: (typeof validPlugins)[number],
        text: string,
        closePanel: () => void,
    ) => {
        const shareLinks = parseMultipleSheetLinks(text);
        if (!shareLinks.length) {
            Toast.warn(t("panel.importMusicSheet.invalidLink"));
            return;
        }

        closePanel();
        Toast.success(t("panel.importMusicSheet.importing"));

        for (const link of shareLinks) {
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

    const openInput = (
        plugin: (typeof validPlugins)[number],
        prefill?: string,
    ) => {
        showPanel("SimpleInput", {
            title: t("panel.importMusicSheet.title"),
            placeholder: t("panel.importMusicSheet.placeholder"),
            hints: plugin.instance.hints?.importMusicSheet,
            maxLength: 2000,
            defaultValue: prefill ?? "",
            async onOk(text, closePanel) {
                await runImport(plugin, text, closePanel);
            },
        });
    };

    return (
        <PanelBase
            height={vmax(60)}
            renderBody={() => (
                <>
                    <PanelHeader hideButtons title={t("panel.importMusicSheet.title")} />
                    <View style={{ paddingHorizontal: rpx(24) }}>
                        <View style={{ opacity: 0.6, paddingVertical: rpx(12) }}>
                            支持直接粘贴 QQ音乐 / 网易云音乐 的分享链接或分享文案
                        </View>
                    </View>

                    {/* 剪贴板里如果有可识别的歌单链接，优先展示一键导入 */}
                    {clipLinks.length && validPlugins.length ? (
                        <View style={{ paddingHorizontal: rpx(24), paddingBottom: rpx(12) }}>
                            {clipLinks.map(link => (
                                <ListItem
                                    key={link.normalizedUrl}
                                    withHorizontalPadding
                                    onPress={() => {
                                        // 预填原始分享文本，用户可直接确认
                                        openInput(
                                            validPlugins[0],
                                            link.rawText || link.normalizedUrl,
                                        );
                                    }}>
                                    <ListItem.Content
                                        title={`从剪贴板导入 ${PLATFORM_LABEL[link.platform]}${
                                            link.id ? `（${link.id}）` : ""
                                        }`}
                                    />
                                </ListItem>
                            ))}
                        </View>
                    ) : null}

                    {validPlugins.length ? (
                        <View style={globalStyle.fwflex1}>
                            <FlatList
                                data={validPlugins}
                                keyExtractor={plugin => plugin.hash}
                                style={{ marginBottom: safeAreaInsets.bottom }}
                                renderItem={({ item: plugin }) => (
                                    <ListItem
                                        withHorizontalPadding
                                        key={`${plugin.hash}`}
                                        onPress={() => openInput(plugin)}>
                                        <ListItem.Content title={plugin.name} />
                                    </ListItem>
                                )}
                            />
                        </View>
                    ) : (
                        <NoPlugin
                            notSupportType={t("panel.importMusicSheet.title")}
                        />
                    )}
                </>
            )}
        />
    );
}
