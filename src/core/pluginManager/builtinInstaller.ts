/**
 * 内置音源安装执行器
 *
 * 自动（首次启动）和手动（用户点「一键安装」）都走这里，
 * 保证两边的行为完全一致。
 */
import axios from "axios";
import PluginManager from "@/core/pluginManager";
import { errorLog } from "@/utils/log";
import {
    BUILTIN_SUBSCRIBE_FLAG,
    BUILTIN_SUBSCRIBE_URLS,
    normalizeSubscribeManifest,
    type IBuiltinPluginEntry,
} from "./builtinSubscribe";
import PersistStatus from "@/utils/persistStatus";

export interface IBuiltinInstallResult {
    okCount: number;
    failCount: number;
    names: string[];
    failures: Array<{ name: string; reason: string }>;
}

/** 拉取所有内置订阅清单，展开成插件条目 */
export async function fetchBuiltinPluginEntries(): Promise<IBuiltinPluginEntry[]> {
    const entries: IBuiltinPluginEntry[] = [];
    const seen = new Set<string>();

    for (const manifestUrl of BUILTIN_SUBSCRIBE_URLS) {
        try {
            const resp = await axios.get(manifestUrl, {
                timeout: 20000,
                headers: {
                    "Cache-Control": "no-cache",
                    Pragma: "no-cache",
                    "User-Agent":
                        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X)",
                },
            });

            const parsed = normalizeSubscribeManifest(resp.data);

            if (parsed.length) {
                for (const e of parsed) {
                    if (!seen.has(e.url)) {
                        seen.add(e.url);
                        entries.push(e);
                    }
                }
            } else {
                // 清单本身就是单个插件
                if (!seen.has(manifestUrl)) {
                    seen.add(manifestUrl);
                    entries.push({ name: "内置插件", url: manifestUrl });
                }
            }
        } catch (e) {
            errorLog("内置订阅清单拉取失败", { url: manifestUrl, e });
        }
    }

    return entries;
}

/**
 * 批量安装内置音源。
 *
 * @param config.force 为 true 时忽略已安装标记（用户手动点「一键安装」）
 */
export async function installBuiltinPlugins(config?: {
    force?: boolean;
    onProgress?: (done: number, total: number, name: string) => void;
}): Promise<IBuiltinInstallResult> {
    const result: IBuiltinInstallResult = {
        okCount: 0,
        failCount: 0,
        names: [],
        failures: [],
    };

    if (!BUILTIN_SUBSCRIBE_URLS.length) {
        return result;
    }

    // 非强制时：已初始化过就跳过
    if (!config?.force && PersistStatus.get(BUILTIN_SUBSCRIBE_FLAG)) {
        return result;
    }

    const entries = await fetchBuiltinPluginEntries();
    const total = entries.length;
    let done = 0;

    for (const entry of entries) {
        done++;
        config?.onProgress?.(done, total, entry.name);
        try {
            const r = await PluginManager.installPluginFromUrl(entry.url, {
                notCheckVersion: true,
            });
            if (r?.success) {
                result.okCount++;
                result.names.push(r.pluginName ?? entry.name);
            } else {
                result.failCount++;
                result.failures.push({
                    name: entry.name,
                    reason: r?.message ?? "未知原因",
                });
            }
        } catch (e: any) {
            result.failCount++;
            result.failures.push({
                name: entry.name,
                reason: e?.message ?? "网络或解析失败",
            });
        }
    }

    PersistStatus.set(BUILTIN_SUBSCRIBE_FLAG, true);
    return result;
}
