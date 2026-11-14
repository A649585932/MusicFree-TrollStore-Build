/**
 * 短链跟随跳转 —— 自动提取真实 ID
 *
 * 核心思路（用户提的，也是对的）：
 *   与其手动处理 302 / 读 location 头，不如**让 HTTP 客户端自己跟随跳转**，
 *   然后直接读「最终 URL」。这样不受 CORS、header 大小写、重定向链长度影响。
 *
 * React Native 的 XHR 原生支持 `responseURL`（见
 * node_modules/react-native/Libraries/Network/XMLHttpRequest.js:125/308-325），
 * 它就是「跟随完所有跳转后的最终地址」。
 *
 * 所以实现分三层，逐层降级：
 *   1. XHR + responseURL        ← RN 上最可靠
 *   2. fetch + response.url     ← 浏览器 / Node 18+
 *   3. XHR 手动读 location 头    ← 兜底
 */

const UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1";

export interface IResolveResult {
    /** 最终 URL（可能等于输入） */
    finalUrl: string;
    /** 是否真的发生了跳转 */
    redirected: boolean;
    /** 用哪种方式拿到的 */
    via: "xhr-responseURL" | "fetch-url" | "manual-location" | "none";
}

/**
 * 方案 1：XHR + responseURL（RN 首选）
 *
 * 关键点：
 *   - 不设 redirect 限制，让原生层自动跟随
 *   - 读完响应头就够了，正文不需要 → 立即 abort 省流量
 *   - responseURL 在 readyState >= 2 时就有了
 */
function resolveViaXhr(url: string): Promise<IResolveResult | null> {
    return new Promise(resolve => {
        let settled = false;
        const done = (r: IResolveResult | null) => {
            if (!settled) {
                settled = true;
                resolve(r);
            }
        };

        try {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.setRequestHeader("Accept", "text/html,*/*");

            xhr.onreadystatechange = () => {
                if (xhr.readyState >= 2) {
                    const finalUrl: string =
                        (xhr as any).responseURL || "";
                    if (finalUrl) {
                        try {
                            xhr.abort();
                        } catch {
                            /* ignore */
                        }
                        done({
                            finalUrl,
                            redirected: finalUrl !== url,
                            via: "xhr-responseURL",
                        });
                        return;
                    }
                    if (xhr.readyState === 4) {
                        done(null);
                    }
                }
            };

            xhr.onerror = () => done(null);
            xhr.ontimeout = () => done(null);
            xhr.send();
        } catch {
            done(null);
        }
    });
}

/**
 * 方案 2：fetch + response.url
 * 浏览器和 Node 18+ 都支持；RN 的 fetch 也会透传最终 URL。
 */
async function resolveViaFetch(url: string): Promise<IResolveResult | null> {
    try {
        const resp = await fetch(url, {
            method: "GET",
            headers: { "User-Agent": UA, Accept: "text/html,*/*" },
        } as any);

        const finalUrl: string = (resp as any).url || "";
        if (finalUrl) {
            return {
                finalUrl,
                redirected: finalUrl !== url,
                via: "fetch-url",
            };
        }
        // fetch 拿不到 url 时，退读 location（不跟随的情况下才有意义）
        const loc = resp.headers?.get?.("location");
        if (loc) {
            return {
                finalUrl: absolutize(url, loc),
                redirected: true,
                via: "manual-location",
            };
        }
        return null;
    } catch {
        return null;
    }
}

/** 方案 3：XHR 手动读 location（兜底，处理不自动跟随的场景） */
function resolveViaLocationHeader(url: string): Promise<IResolveResult | null> {
    return new Promise(resolve => {
        let settled = false;
        const done = (r: IResolveResult | null) => {
            if (!settled) {
                settled = true;
                resolve(r);
            }
        };

        try {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.setRequestHeader("Accept", "text/html,*/*");

            xhr.onreadystatechange = () => {
                if (xhr.readyState >= 2) {
                    let loc: string | null = null;
                    try {
                        loc =
                            xhr.getResponseHeader("location") ??
                            xhr.getResponseHeader("Location");
                        if (!loc) {
                            const all = xhr.getAllResponseHeaders() || "";
                            const m = all.match(/^\s*location\s*:\s*(.+)$/im);
                            if (m) {
                                loc = m[1].trim();
                            }
                        }
                    } catch {
                        loc = null;
                    }

                    if (loc) {
                        try {
                            xhr.abort();
                        } catch {
                            /* ignore */
                        }
                        done({
                            finalUrl: absolutize(url, loc),
                            redirected: true,
                            via: "manual-location",
                        });
                        return;
                    }
                    if (xhr.readyState === 4) {
                        done(null);
                    }
                }
            };

            xhr.onerror = () => done(null);
            xhr.ontimeout = () => done(null);
            xhr.send();
        } catch {
            done(null);
        }
    });
}

/** 相对 location 转绝对 */
function absolutize(base: string, loc: string): string {
    if (/^https?:\/\//i.test(loc)) {
        return loc;
    }
    if (loc.startsWith("//")) {
        return "https:" + loc;
    }
    const m = base.match(/^(https?:\/\/[^/]+)/i);
    const origin = m ? m[1] : "";
    if (loc.startsWith("/")) {
        return origin + loc;
    }
    const pathPart = base.replace(/^(https?:\/\/[^/]+)/i, "");
    const dir = pathPart.replace(/\/[^/]*$/, "/");
    return origin + dir + loc;
}

/**
 * 跟随短链，返回最终 URL 与跳转信息。
 * 三层降级，任何一层成功就返回。
 */
export async function followRedirects(
    url: string,
): Promise<string | null> {
    const result = await resolveFinalUrl(url);
    return result.finalUrl;
}

/** 完整版：返回跳转详情，便于 UI 显示"已跟随跳转" */
export async function resolveFinalUrl(url: string): Promise<IResolveResult> {
    const fallback: IResolveResult = {
        finalUrl: url,
        redirected: false,
        via: "none",
    };

    // 1) XHR responseURL
    if (typeof XMLHttpRequest !== "undefined") {
        const r1 = await resolveViaXhr(url);
        if (r1) {
            return r1;
        }
    }

    // 2) fetch response.url
    if (typeof fetch !== "undefined") {
        const r2 = await resolveViaFetch(url);
        if (r2) {
            return r2;
        }
    }

    // 3) 手动读 location
    if (typeof XMLHttpRequest !== "undefined") {
        const r3 = await resolveViaLocationHeader(url);
        if (r3) {
            return r3;
        }
    }

    return fallback;
}

/** 短链特征判定 */
export function isShortLink(url: string): boolean {
    return (
        /c\d*\.y\.qq\.com\/base\/fcgi-bin\/u/i.test(url) ||
        /u\?__=/i.test(url) ||
        /163cn\.tv/i.test(url) ||
        /url\.cn\//i.test(url) ||
        /t\.cn\//i.test(url) ||
        /b23\.tv\//i.test(url)
    );
}

/**
 * 从最终 URL 里提取歌单 ID。
 * 支持 QQ / 网易云 / 通用 ?id= 形式。
 */
export function extractSheetIdFromUrl(finalUrl: string): {
    platform: "qq" | "netease" | "unknown";
    id: string | null;
} {
    const u = finalUrl.toLowerCase();

    let platform: "qq" | "netease" | "unknown" = "unknown";
    if (u.includes("qq.com")) {
        platform = "qq";
    } else if (u.includes("163.com") || u.includes("163cn.tv")) {
        platform = "netease";
    }

    // 通用：?id=数字 / /playlist/数字 / taoge.html?id=数字
    const patterns = [
        /[?&]id=(\d{4,})/i,
        /[?&]disstid=(\d{4,})/i,
        /\/playlist\/(\d{4,})/i,
        /taoge\.html[^#]*[?&]id=(\d{4,})/i,
        /\/discover\/toplist\/(\d{4,})/i,
    ];
    for (const p of patterns) {
        const m = finalUrl.match(p);
        if (m) {
            return { platform, id: m[1] };
        }
    }

    return { platform, id: null };
}
