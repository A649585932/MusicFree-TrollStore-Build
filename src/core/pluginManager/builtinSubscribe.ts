/**
 * 内置音源订阅
 *
 * 目的：让 App 装上就能直接搜歌，不用用户自己去订阅插件市场。
 *
 * 原理：
 *   1. 首次启动（或用户还没装过任何插件）时，拉取这里的订阅清单；
 *   2. 清单里每个条目是一个插件 .js 的 URL，逐个交给 PluginManager 安装；
 *   3. 装完打标记，之后不再自动打扰；用户手动删掉的也不会被强行装回来。
 *
 * 想换成自己的订阅源，只改 BUILTIN_SUBSCRIBE_URLS 即可。
 */

/** 内置订阅清单（可放多个） */
export const BUILTIN_SUBSCRIBE_URLS: string[] = [
    "https://gh.padao.fun/https://raw.githubusercontent.com/hebijunge/musicfree-plugins/master/sub/padao/main.json",
];

/** 标记「内置订阅已初始化过」，避免每次启动都去拉 */
export const BUILTIN_SUBSCRIBE_FLAG = "app.builtinSubscribeDone";

/** 订阅清单的结构 */
interface ISubscribeManifest {
    desc?: string;
    plugins?: Array<{
        name?: string;
        url: string;
        version?: string;
    }>;
}

export interface IBuiltinPluginEntry {
    name: string;
    url: string;
    version?: string;
}

/**
 * 展开订阅清单：清单本身可能是一个「插件 URL 列表」，
 * 也可能直接就是一个插件 JS。两种都兼容。
 *
 * @param body 请求到的响应体（字符串或已解析对象）
 */
export function normalizeSubscribeManifest(
    body: unknown,
): IBuiltinPluginEntry[] {
    // 直接是字符串：可能是一个 .js 插件，也可能是 JSON 文本
    if (typeof body === "string") {
        const text = body.trim();
        if (!text) {
            return [];
        }
        // 是 JSON 就解析后递归处理
        if (text.startsWith("{") || text.startsWith("[")) {
            try {
                return normalizeSubscribeManifest(JSON.parse(text));
            } catch {
                return [];
            }
        }
        // 否则当作单个插件 URL 或插件源码
        if (/^https?:\/\//i.test(text)) {
            return [{ name: "内置插件", url: text }];
        }
        // 是插件源码本身：无法在此推断 URL，交由调用方按「内容安装」处理
        return [];
    }

    // 数组：元素可能是字符串 URL 或 {name,url}
    if (Array.isArray(body)) {
        const out: IBuiltinPluginEntry[] = [];
        for (const item of body) {
            out.push(...normalizeSubscribeManifest(item));
        }
        return out;
    }

    // 对象：处理 {plugins:[...]} 或直接的 {url:...}
    if (body && typeof body === "object") {
        const obj = body as Record<string, unknown>;

        if (Array.isArray(obj.plugins)) {
            const out: IBuiltinPluginEntry[] = [];
            for (const p of obj.plugins as unknown[]) {
                if (typeof p === "string") {
                    out.push({ name: "内置插件", url: p });
                } else if (p && typeof p === "object") {
                    const e = p as Record<string, unknown>;
                    if (typeof e.url === "string") {
                        out.push({
                            name:
                                typeof e.name === "string" ? e.name : "内置插件",
                            url: e.url,
                            version:
                                typeof e.version === "string"
                                    ? e.version
                                    : undefined,
                        });
                    }
                }
            }
            return out;
        }

        if (typeof obj.url === "string") {
            return [
                {
                    name: typeof obj.name === "string" ? obj.name : "内置插件",
                    url: obj.url,
                    version:
                        typeof obj.version === "string"
                            ? obj.version
                            : undefined,
                },
            ];
        }
    }

    return [];
}
