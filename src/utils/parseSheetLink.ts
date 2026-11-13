/**
 * 第三方歌单分享链接解析
 *
 * 难点：
 *   1. QQ音乐分享出来的是短链（c6.y.qq.com/base/fcgi-bin/u?__=xxx），
 *      里面**没有** id，必须先发一次 HTTP 请求跟随 302 拿到真实地址；
 *   2. 网易云链接常带 uct2 / userid 等参数，部分插件要求原样透传，
 *      过度归一化反而解析失败；
 *   3. 用户粘贴的往往是整段分享文案，需要先把 URL 抠出来。
 *
 * 因此这里提供两层 API：
 *   - parseSheetShareLink()  纯函数，离线快速识别（用于 UI 即时反馈）
 *   - resolveSheetShareLink() 异步，短链会发请求跟随跳转再解析（用于真正导入）
 */

export type SheetPlatform = "qq" | "netease" | "unknown";

export interface IParsedSheetLink {
    platform: SheetPlatform;
    id: string | null;
    normalizedUrl: string;
    rawUrl: string;
    rawText: string;
    /** 是否经过网络跳转解析得到 */
    resolved?: boolean;
}

export const PLATFORM_LABEL: Record<SheetPlatform, string> = {
    qq: "QQ音乐",
    netease: "网易云音乐",
    unknown: "其他",
};

/** 从分享文案里抠出所有 http(s) 链接 */
export function extractUrls(text: string): string[] {
    if (!text) {
        return [];
    }
    const m = text.match(/https?:\/\/[^\s，,。；;、"'"''）)】\]]+/gi);
    return m ? m : [];
}

/** 抠出第一个链接 */
export function extractUrl(text: string): string | null {
    return extractUrls(text)[0] ?? null;
}

function detectPlatform(url: string): SheetPlatform {
    const u = url.toLowerCase();
    // 注意 c6.y.qq.com 也要归到 qq
    if (u.includes("qq.com")) {
        return "qq";
    }
    if (u.includes("163.com") || u.includes("163cn.tv") || u.includes("music.163")) {
        return "netease";
    }
    return "unknown";
}

/** QQ 短链判定 */
function isQQShortLink(url: string): boolean {
    return /c\d*\.y\.qq\.com\/base\/fcgi-bin\/u/i.test(url) || /u\?__=/i.test(url);
}

/** 网易云短链判定 */
function isNeteaseShortLink(url: string): boolean {
    return /163cn\.tv/i.test(url) || /y\.music\.163\.com\/m\/song/i.test(url);
}

function parseQQId(url: string): string | null {
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
    return null;
}

function parseNeteaseId(url: string): string | null {
    const patterns = [/[?&]id=(\d+)/i, /\/playlist\/(\d+)/i, /\/discover\/toplist\/(\d+)/i];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) {
            return m[1];
        }
    }
    return null;
}

/**
 * 离线解析（不联网）。短链会返回 id=null，但仍会保留原链，
 * 交给 resolveSheetShareLink() 或插件自己处理。
 */
export function parseSheetShareLink(input: string): IParsedSheetLink | null {
    const rawText = (input ?? "").trim();
    if (!rawText) {
        return null;
    }
    const rawUrl = extractUrl(rawText) ?? (rawText.startsWith("http") ? rawText : null);
    if (!rawUrl) {
        return null;
    }

    const platform = detectPlatform(rawUrl);

    if (platform === "qq") {
        const id = parseQQId(rawUrl);
        return {
            platform,
            id,
            // 有 id 才归一化；短链/无 id 原样保留（插件能自己跟跳转）
            normalizedUrl: id ? `https://y.qq.com/n/ryqq/playlist/${id}` : rawUrl,
            rawUrl,
            rawText,
        };
    }

    if (platform === "netease") {
        const id = parseNeteaseId(rawUrl);
        return {
            platform,
            id,
            // 关键：有 id 时保留原始完整 URL（含 uct2 等参数），
            // 因为部分插件依赖这些参数签名；只有没 id 才尝试构造。
            normalizedUrl: id ? rawUrl : rawUrl,
            rawUrl,
            rawText,
        };
    }

    return {
        platform: "unknown",
        id: null,
        normalizedUrl: rawUrl,
        rawUrl,
        rawText,
    };
}

/**
 * 异步解析：短链会发 HTTP 请求跟随跳转，拿到真实 URL 后再提取 id。
 *
 * @param input 分享文本
 * @param follow 跳转跟随函数（注入 axios/react-native 的 fetch 均可），
 *              返回最终 URL；失败时返回 null
 */
export async function resolveSheetShareLink(
    input: string,
    follow?: (url: string) => Promise<string | null>,
): Promise<IParsedSheetLink | null> {
    const base = parseSheetShareLink(input);
    if (!base) {
        return null;
    }

    // 已有 id 就不用跳转
    if (base.id) {
        return base;
    }

    const needFollow =
        (base.platform === "qq" && isQQShortLink(base.rawUrl)) ||
        (base.platform === "netease" && isNeteaseShortLink(base.rawUrl)) ||
        base.platform === "unknown";

    if (!needFollow || !follow) {
        return base;
    }

    try {
        const finalUrl = await follow(base.rawUrl);
        if (!finalUrl) {
            return base;
        }
        const resolved = parseSheetShareLink(finalUrl);
        if (resolved && resolved.id) {
            return { ...resolved, resolved: true, rawText: base.rawText };
        }
        // 跳转后仍无 id，但链接变了，用新链接再试
        return resolved
            ? { ...resolved, resolved: true, rawText: base.rawText }
            : base;
    } catch {
        return base;
    }
}

/**
 * 一次解析多个链接（离线版）。保留输入顺序并去重。
 */
export function parseMultipleSheetLinks(input: string): IParsedSheetLink[] {
    if (!input) {
        return [];
    }
    const urls = extractUrls(input);
    const seen = new Set<string>();
    const result: IParsedSheetLink[] = [];
    for (const u of urls) {
        const parsed = parseSheetShareLink(u);
        if (parsed && !seen.has(parsed.normalizedUrl)) {
            seen.add(parsed.normalizedUrl);
            result.push(parsed);
        }
    }
    return result;
}

/**
 * 一次解析多个链接（异步版，短链会跟随跳转）。
 */
export async function resolveMultipleSheetLinks(
    input: string,
    follow?: (url: string) => Promise<string | null>,
): Promise<IParsedSheetLink[]> {
    if (!input) {
        return [];
    }
    const urls = extractUrls(input);
    const seen = new Set<string>();
    const result: IParsedSheetLink[] = [];
    for (const u of urls) {
        const parsed = await resolveSheetShareLink(u, follow);
        if (parsed && !seen.has(parsed.normalizedUrl)) {
            seen.add(parsed.normalizedUrl);
            result.push(parsed);
        }
    }
    return result;
}
