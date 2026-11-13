/**
 * 短链跟随跳转 —— 兼容 React Native 与 Node（本地测试）
 *
 * 踩坑记录
 * --------
 * 1. axios + maxRedirects:0   → RN 里读不到 responseURL，常拿不到 location
 * 2. fetch + redirect:"manual" → RN 里 location 头会被 CORS 过滤
 * 3. XMLHttpRequest.getAllResponseHeaders() → RN 里**唯一可靠**
 * 4. Node 没有 XMLHttpRequest → 本地测试回退到 fetch
 *
 * 所以：优先 XHR，没有则 fetch。
 */

const UA =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1";

interface IHopResult {
    status: number;
    location: string | null;
}

/** XHR 版：RN 环境用这个，能真正读到 location 头 */
function hopViaXhr(url: string): Promise<IHopResult> {
    return new Promise(resolve => {
        let settled = false;
        const done = (status: number, location: string | null) => {
            if (!settled) {
                settled = true;
                resolve({ status, location });
            }
        };

        try {
            const xhr = new XMLHttpRequest();
            xhr.open("GET", url, true);
            xhr.setRequestHeader("Accept", "text/html,*/*");
            xhr.timeout = 12000;

            xhr.onreadystatechange = () => {
                // HEADERS_RECEIVED(2) 时头已可读
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

                    // 3xx：拿到头就够了，立刻中断省流量
                    if (xhr.status >= 300 && xhr.status < 400) {
                        try {
                            xhr.abort();
                        } catch {
                            /* ignore */
                        }
                        done(xhr.status, loc);
                        return;
                    }
                    if (xhr.readyState === 4) {
                        done(xhr.status, loc);
                    }
                }
            };

            xhr.onerror = () => done(0, null);
            xhr.ontimeout = () => done(0, null);
            xhr.send();
        } catch {
            done(0, null);
        }
    });
}

/** fetch 版：Node 本地测试用 */
async function hopViaFetch(url: string): Promise<IHopResult> {
    try {
        const resp = await fetch(url, {
            method: "GET",
            redirect: "manual",
            headers: { "User-Agent": UA, Accept: "text/html,*/*" },
        } as any);
        const loc =
            (resp.headers && (resp.headers.get("location") as string | null)) ??
            null;
        return { status: resp.status, location: loc };
    } catch {
        return { status: 0, location: null };
    }
}

async function oneHop(url: string): Promise<IHopResult> {
    if (typeof XMLHttpRequest !== "undefined") {
        return hopViaXhr(url);
    }
    return hopViaFetch(url);
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
 * 跟随短链，返回最终 URL。失败时返回原 URL（不抛错）。
 */
export async function followRedirects(
    url: string,
    maxHops = 8,
): Promise<string | null> {
    let current = url;

    for (let i = 0; i < maxHops; i++) {
        const { status, location } = await oneHop(current);

        if (status >= 300 && status < 400 && location) {
            current = absolutize(current, location);
            continue;
        }
        if (status >= 200 && status < 300) {
            return current;
        }
        // 失败：用当前地址兜底
        return current;
    }

    return current;
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
