/**
 * 内置音源安装执行器
 *
 * 关键教训（来自真机调试）：
 *   gh.padao.fun 这类加速代理返回的 Content-Type 是 text/plain，
 *   axios 不会自动 JSON.parse，resp.data 是**字符串**，
 *   且字符串可能带 BOM / 前后空白，直接 startsWith("{") 会失败。
 *
 * 因此这里做了三重加固：
 *   1. 强制按文本取出，手动 trim + 去 BOM，再 JSON.parse；
 *   2. 解析失败时回退到「正则抠 plugins 数组里的 url」；
 *   3. 对每个 URL 做绝对地址校验，避免相对路径导致下载失败。
 *
 * 另外「自动补齐」不依赖任何持久标记：每次启动都检查缺哪些，
 * 缺什么装什么，已装跳过。用户可以随时删插件，下次启动自动补回。
 */
import axios from "axios";
import PluginManager from "@/core/pluginManager";
import { errorLog, trace } from "@/utils/log";
import {
    BUILTIN_SUBSCRIBE_FLAG,
    BUILTIN_SUBSCRIBE_URLS,
    normalizeSubscribeManifest,
    type IBuiltinPluginEntry,
} from "./builtinSubscribe";
import PersistStatus from "@/utils/persistStatus";

/** 设为 false 可关闭「开机自动补齐」 */
export const AUTO_INSTALL_ON_BOOT = true;

const UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1";

export interface IBuiltinInstallResult {
    okCount: number;
    failCount: number;
    skippedCount: number;
    names: string[];
    failures: Array<{ name: string; reason: string }>;
}

/** 去掉 BOM 与首尾空白 */
function cleanText(input: string): string {
    return input.replace(/^\uFEFF/, "").trim();
}

/**
 * 把响应体解析成 JSON 对象。
 * axios 在 Content-Type 非 json 时不会自动解析，所以这里强制再试一次。
 */
function forceJsonParse(data: unknown): unknown {
    if (data && typeof data === "object") {
        return data;
    }
    if (typeof data !== "string") {
        return data;
    }
    const text = cleanText(data);
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        // 不是合法 JSON，返回原文交给上层按字符串处理
        return text;
    }
}

/**
 * 从任意文本里用正则兜底抠出所有插件 URL。
 * 用于 JSON 解析失败（比如响应被截断）时的救命通道。
 */
function extractPluginUrlsByRegex(text: string): string[] {
    const out: string[] = [];
    const re = /https?:\/\/[^\s"'<>,)\]]+\.js(?:\?[^\s"'<>,)\]]*)?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
        if (!out.includes(m[0])) {
            out.push(m[0]);
        }
    }
    return out;
}

/** 拉取所有内置订阅清单，展开成插件条目 */
export async function fetchBuiltinPluginEntries(): Promise<IBuiltinPluginEntry[]> {
    const entries: IBuiltinPluginEntry[] = [];
    const seen = new Set<string>();

    for (const manifestUrl of BUILTIN_SUBSCRIBE_URLS) {
        trace("内置订阅：拉取清单", manifestUrl);
        try {
            const resp = await axios.get(manifestUrl, {
                timeout: 25000,
                headers: {
                    "Cache-Control": "no-cache",
                    Pragma: "no-cache",
                    Accept: "application/json, text/plain, */*",
                    "User-Agent": UA,
                },
                // 关键：作为纯文本取回，自己解析，避免 axios 的类型推断差异
                responseType: "text",
                transformResponse: [(d: any) => d],
            });

            const parsed = forceJsonParse(resp.data);
            let list = normalizeSubscribeManifest(parsed);
            trace("内置订阅：解析结果", `${list.length} 个`);

            if (!list.length && typeof resp.data === "string") {
                // JSON 解析失败 → 正则兜底
                const urls = extractPluginUrlsByRegex(resp.data);
                trace("内置订阅：正则兜底", `${urls.length} 个`);
                list = urls.map((u, i) => ({ name: `内置插件${i + 1}`, url: u }));
            }

            if (!list.length) {
                // 清单本身就是单个插件 js
                list = [{ name: "内置插件", url: manifestUrl }];
            }

            for (const e of list) {
                // 只接受绝对 http(s) 地址
                if (!/^https?:\/\//i.test(e.url)) {
                    trace("内置订阅：跳过非绝对地址", e.url);
                    continue;
                }
                if (!seen.has(e.url)) {
                    seen.add(e.url);
                    entries.push(e);
                }
            }
        } catch (e: any) {
            errorLog("内置订阅清单拉取失败", {
                url: manifestUrl,
                message: e?.message,
            });
        }
    }

    trace("内置订阅：最终条目", entries.length);
    return entries;
}

/** 已安装插件名称集合（小写归一，便于匹配） */
function installedNames(): string[] {
    try {
        return PluginManager.getSortedPlugins()
            .map(p => `${p.name ?? ""}`.trim().toLowerCase())
            .filter(Boolean);
    } catch {
        return [];
    }
}

/** 判断某个内置插件是否已经装过 */
function isAlreadyInstalled(
    entry: IBuiltinPluginEntry,
    names: string[],
): boolean {
    const want = (entry.name || "").trim().toLowerCase();
    if (!want) {
        return false;
    }
    return names.some(have => {
        if (!have) {
            return false;
        }
        // 精确 / 包含（"QQ音乐" vs "QQ音乐插件"）
        return have === want || have.includes(want) || want.includes(have);
    });
}

/**
 * 批量安装内置音源（增量）：
 *   - 默认只补缺失的；
 *   - force=true 时全部重装（用于手动「一键安装」）。
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
    if (!entries.length) {
        errorLog("内置订阅：没有拿到任何插件条目", BUILTIN_SUBSCRIBE_URLS);
        return result;
    }

    const total = entries.length;
    let done = 0;
    const names = config?.force ? [] : installedNames();

    for (const entry of entries) {
        done++;

        if (!config?.force && isAlreadyInstalled(entry, names)) {
            result.skippedCount++;
            config?.onProgress?.(done, total, entry.name);
            trace("内置订阅：已存在，跳过", entry.name);
            continue;
        }

        config?.onProgress?.(done, total, entry.name);
        trace("内置订阅：安装中", entry.name);

        try {
            const r = await PluginManager.installPluginFromUrl(entry.url, {
                notCheckVersion: true,
            });
            if (r?.success) {
                result.okCount++;
                result.names.push(r.pluginName ?? entry.name);
                trace("内置订阅：安装成功", r.pluginName ?? entry.name);
            } else {
                result.failCount++;
                result.failures.push({
                    name: entry.name,
                    reason: r?.message ?? "未知原因",
                });
                trace("内置订阅：安装失败", `${entry.name} - ${r?.message}`);
            }
        } catch (e: any) {
            result.failCount++;
            result.failures.push({
                name: entry.name,
                reason: e?.message ?? "网络或解析失败",
            });
            trace("内置订阅：安装异常", `${entry.name} - ${e?.message}`);
        }
    }

    PersistStatus.set(BUILTIN_SUBSCRIBE_FLAG, true);
    return result;
}
