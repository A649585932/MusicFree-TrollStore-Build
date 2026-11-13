/**
 * 短链跟随跳转
 *
 * 为什么不用 axios 的 responseURL：
 *   React Native 的 XMLHttpRequest 实现不会暴露 responseURL，
 *   axios 在 RN 里拿到的 resp.request.responseURL 基本都是 undefined，
 *   导致短链解析全部失败。
 *
 * 因此这里手动处理 3xx：把 maxRedirects 设为 0，读 location 头自己跳。
 */
import axios from "axios";

const UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1";

/** 从相对/绝对 location 解析成绝对 URL */
function absolutize(base: string, loc: string): string {
    if (/^https?:\/\//i.test(loc)) {
        return loc;
    }
    if (loc.startsWith("//")) {
        return "https:" + loc;
    }
    try {
        const u = new URL(base);
        if (loc.startsWith("/")) {
            return `${u.protocol}//${u.host}${loc}`;
        }
        const dir = u.pathname.replace(/\/[^/]*$/, "/");
        return `${u.protocol}//${u.host}${dir}${loc}`;
    } catch {
        return loc;
    }
}

/**
 * 跟随短链跳转，返回最终 URL。
 *
 * @param url 起始短链
 * @param maxHops 最多跳几次（防止死循环）
 */
export async function followRedirects(
    url: string,
    maxHops = 8,
): Promise<string | null> {
    let current = url;

    for (let hop = 0; hop < maxHops; hop++) {
        try {
            const resp = await axios.get(current, {
                timeout: 12000,
                // 关键：不自动跳转，自己处理
                maxRedirects: 0,
                validateStatus: () => true,
                headers: {
                    "User-Agent": UA,
                    Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
                },
                // 不要解析响应体，只要头
                responseType: "text",
                transformResponse: [(d: any) => d],
            });

            const status = resp.status;
            const headers = (resp.headers ?? {}) as Record<string, any>;
            const loc = headers["location"] ?? headers["Location"];

            // 3xx 且有 location：继续跳
            if (status >= 300 && status < 400 && typeof loc === "string" && loc) {
                current = absolutize(current, loc);
                continue;
            }

            // 2xx：到终点了
            if (status >= 200 && status < 300) {
                return current;
            }

            // 其他状态码：返回当前 URL 兜底
            return current;
        } catch (e: any) {
            // axios 在 maxRedirects=0 时可能把 3xx 当错误抛出，
            // 从 error.response 里把 location 抠出来继续跳。
            const res = e?.response;
            const loc = res?.headers?.["location"] ?? res?.headers?.["Location"];
            if (loc && typeof loc === "string") {
                current = absolutize(current, loc);
                continue;
            }
            return current;
        }
    }

    return current;
}

/**
 * 直接从分享链接里提取 id（不联网），返回 null 表示需要跳转。
 */
export function extractIdLocally(
    url: string,
    platform: "qq" | "netease" | "unknown",
): string | null {
    if (platform === "qq") {
        const patterns = [
            /[?&]disstid=(\d+)/i,
            /\/playlist\/(\d+)/i,
            /taoge\.html[^#]*[?&]id=(\d+)/i,
            /[?&]id=(\d+)/i,
        ];
        for (const p of patterns) {
            const m = url.match(p);
            if (m) {
                return m[1];
            }
        }
        // 纯数字（用户直接粘 id）
        if (/^\d{4,}$/.test(url.trim())) {
            return url.trim();
        }
        return null;
    }

    if (platform === "netease") {
        const patterns = [
            /[?&]id=(\d+)/i,
            /\/playlist\/(\d+)/i,
            /\/discover\/toplist\/(\d+)/i,
        ];
        for (const p of patterns) {
            const m = url.match(p);
            if (m) {
                return m[1];
            }
        }
        if (/^\d{4,}$/.test(url.trim())) {
            return url.trim();
        }
        return null;
    }

    return null;
}

/** 短链特征判定 */
export function isShortLink(url: string): boolean {
    return (
        /c\d*\.y\.qq\.com\/base\/fcgi-bin\/u/i.test(url) ||
        /u\?__=/i.test(url) ||
        /163cn\.tv/i.test(url) ||
        /url\.cn\//i.test(url) ||
        /t\.cn\//i.test(url)
    );
}
