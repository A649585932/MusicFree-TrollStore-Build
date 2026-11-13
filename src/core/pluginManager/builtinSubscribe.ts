/**
 * 内置音源订阅
 *
 * 目的：让 App 装上就能直接搜歌，不用用户自己一个个订阅插件。
 *
 * 关键点：
 *   - 订阅清单是一个 JSON，里面 plugins[] 有多个插件，必须**全部**装上；
 *   - 清单里每个 url 是插件 js；
 *   - 装过的跳过（按 hash 去重，PluginManager 内部已处理）。
 */

export const BUILTIN_SUBSCRIBE_URLS: string[] = [
    "https://gh.padao.fun/https://raw.githubusercontent.com/hebijunge/musicfree-plugins/master/sub/padao/main.json",
];

export const BUILTIN_SUBSCRIBE_FLAG = "app.builtinSubscribeDone";

export interface IBuiltinPluginEntry {
    name: string;
    url: string;
    version?: string;
}

/**
 * 把订阅清单归一成 [{name,url}]。
 *
 * 兼容多种形态：
 *   - { plugins: [{name,url,version}, ...] }   ← padao 用的就是这种
 *   - { plugins: ["https://...js", ...] }
 *   - [{name,url}, ...]
 *   - ["https://...js", ...]
 *   - "https://...js"  （单个插件 URL）
 *   - { url: "https://...js" }
 */
export function normalizeSubscribeManifest(body: unknown): IBuiltinPluginEntry[] {
    const out: IBuiltinPluginEntry[] = [];
    const seen = new Set<string>();

    const push = (name: string | undefined, url: unknown, version?: unknown) => {
        if (typeof url !== "string" || !url) {
            return;
        }
        if (seen.has(url)) {
            return;
        }
        seen.add(url);
        out.push({
            name: name || "内置插件",
            url,
            version: typeof version === "string" ? version : undefined,
        });
    };

    const walk = (node: unknown) => {
        if (!node) {
            return;
        }
        // 字符串：可能是 JSON 文本，也可能就是插件 URL
        if (typeof node === "string") {
            const text = node.trim();
            if (!text) {
                return;
            }
            if (text.startsWith("{") || text.startsWith("[")) {
                try {
                    walk(JSON.parse(text));
                } catch {
                    // 不是 JSON，忽略
                }
                return;
            }
            if (/^https?:\/\//i.test(text)) {
                push(undefined, text);
            }
            return;
        }
        // 数组
        if (Array.isArray(node)) {
            for (const item of node) {
                walk(item);
            }
            return;
        }
        if (typeof node !== "object") {
            return;
        }
        const obj = node as Record<string, unknown>;

        // { plugins: [...] }  —— 最关键的形态
        if (Array.isArray(obj.plugins)) {
            for (const p of obj.plugins) {
                if (typeof p === "string") {
                    push(undefined, p);
                } else if (p && typeof p === "object") {
                    const e = p as Record<string, unknown>;
                    push(
                        typeof e.name === "string" ? e.name : undefined,
                        e.url,
                        e.version,
                    );
                }
            }
        }

        // 直接的单个插件描述 {name,url}
        if (typeof obj.url === "string") {
            push(
                typeof obj.name === "string" ? obj.name : undefined,
                obj.url,
                obj.version,
            );
        }

        // { data: [...] } 之类的包装
        for (const key of ["data", "items", "list", "sub"]) {
            if (obj[key]) {
                walk(obj[key]);
            }
        }
    };

    walk(body);
    return out;
}
