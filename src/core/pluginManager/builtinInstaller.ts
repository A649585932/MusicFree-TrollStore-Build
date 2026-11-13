/**
 * 内置音源安装执行器
 *
 * 自动（每次启动）和手动（用户点「一键安装」）都走这里。
 *
 * 核心策略是「增量补齐」而不是「一次性装完就打标记」：
 *   - 每次启动都检查清单里有哪些插件还没装，只装缺的；
 *   - 已经装过的（按插件名/平台判断）跳过，不会重复打扰；
 *   - 用户手动删掉的插件，下次启动会**自动补回来**（这正是内置音源的语义）；
 *   - 想彻底关掉自动补装，把 AUTO_INSTALL_ON_BOOT 设为 false。
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

/** 设为 false 可关闭「开机自动补齐」 */
export const AUTO_INSTALL_ON_BOOT = true;

export interface IBuiltinInstallResult {
    okCount: number;
    failCount: number;
    skippedCount: number;
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
            } else if (!seen.has(manifestUrl)) {
                seen.add(manifestUrl);
                entries.push({ name: "内置插件", url: manifestUrl });
            }
        } catch (e) {
            errorLog("内置订阅清单拉取失败", { url: manifestUrl, e });
        }
    }

    return entries;
}

/** 判断某个内置插件是否已经装过（按名称粗匹配，插件内部还会按 hash 去重） */
function isAlreadyInstalled(entry: IBuiltinPluginEntry): boolean {
    const want = (entry.name || "").trim();
    if (!want) {
        return false;
    }
    const installed = PluginManager.getSortedPlugins();
    return installed.some(p => {
        const have = `${p.name ?? ""}`.trim();
        if (!have) {
            return false;
        }
        // 名称完全一致，或互相包含（"QQ音乐" vs "QQ音乐插件"）
        return have === want || have.includes(want) || want.includes(have);
    });
}

/**
 * 批量安装内置音源。
 *
 * @param config.force 为 true 时忽略「已安装」判断，全部重装一遍
 */
export async function installBuiltinPlugins(config?: {
    force?: boolean;
    onProgress?: (done: number, total: number, name: string) => void;
}): Promise<IBuiltinInstallResult> {
    const result: IBuiltinInstallResult = {
        okCount: 0,
        failCount: 0,
        skippedCount: 0,
        names: [],
        failures: [],
    };

    if (!BUILTIN_SUBSCRIBE_URLS.length) {
        return result;
    }

    const entries = await fetchBuiltinPluginEntries();
    const total = entries.length;
    let done = 0;

    for (const entry of entries) {
        done++;

        // 增量模式：已装的直接跳过
        if (!config?.force && isAlreadyInstalled(entry)) {
            result.skippedCount++;
            config?.onProgress?.(done, total, entry.name);
            continue;
        }

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
