/**
 * 第三方歌单分享链接解析
 *
 * 场景：用户从 QQ 音乐 / 网易云音乐 App 点「分享 → 复制链接」，得到一段带
 * 分享短链的文本，直接粘进 MusicFree 的「导入歌单」是识别不了的，因为：
 *
 *   * 分享出来的常常不是歌单页 URL，而是：
 *       - QQ 音乐：https://c6.y.qq.com/base/fcgi-bin/u?__=xxxxx    （短链，需跳转）
 *       - 网易云： https://163cn.tv/xxxxxx                          （短链，需跳转）
 *   * 即使拿到长链，插件要的是纯 id（如 QQ 的 disstid、网易的 playlist?id=xxx）
 *
 * 这里做两件事：
 *   1. 从任意分享文本里用正则抠出 URL；
 *   2. 把 URL 归一成「平台 + id」，同时保留原始长链形式交给插件兜底。
 *
 * 不做网络请求：跳转解析交给插件自己去做（插件运行在有网络权限的 JS 沙箱里，
 * 而这里保持纯函数，便于测试与复用）。
 */

export type SheetPlatform = "qq" | "netease" | "unknown";

export interface IParsedSheetLink {
    /** 识别出的平台 */
    platform: SheetPlatform;
    /** 歌单 id（识别不出时为 null，此时用 rawUrl 交给插件兜底） */
    id: string | null;
    /** 归一化后的长链，最适合直接喂给插件 */
    normalizedUrl: string;
    /** 原始 URL */
    rawUrl: string;
    /** 原始输入文本（可能包含分享文案） */
    rawText: string;
}

/** 从分享文案里抠出第一个 http(s) 链接 */
export function extractUrl(text: string): string | null {
    if (!text) {
        return null;
    }
    const m = text.match(/https?:\/\/[^\s，,。；;、"'"''）)】\]]+/i);
    return m ? m[0] : null;
}

/** QQ 音乐歌单链接 → disstid */
function parseQQ(url: string): string | null {
    // https://y.qq.com/n/ryqq/playlist/7823490513
    // https://i.y.qq.com/n2/m/share/details/taoge.html?id=7823490513
    // https://c6.y.qq.com/base/fcgi-bin/u?__=AbCdEf   （短链，无法离线还原 id）
    const patterns = [
        /[?&]disstid=(\d+)/i,
        /\/playlist\/(\d+)/i,
        /[?&]id=(\d+)/i,
        /taoge\.html[^#]*[?&]id=(\d+)/i,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) {
            return m[1];
        }
    }
    return null;
}

/** 网易云歌单链接 → playlist id */
function parseNetease(url: string): string | null {
    // https://music.163.com/playlist?id=24381616
    // https://music.163.com/#/playlist?id=24381616
    // https://y.music.163.com/m/playlist?id=24381616
    const patterns = [
        /[?&]id=(\d+)/i,
        /\/playlist\/(\d+)/i,
    ];
    for (const p of patterns) {
        const m = url.match(p);
        if (m) {
            return m[1];
        }
    }
    return null;
}

function detectPlatform(url: string): SheetPlatform {
    const host = url.toLowerCase();
    if (host.includes("qq.com") || host.includes("y.qq.com")) {
        return "qq";
    }
    if (host.includes("163.com") || host.includes("music.163.com") || host.includes("163cn.tv")) {
        return "netease";
    }
    return "unknown";
}

/**
 * 解析一段分享文本/链接。
 *
 * @returns 解析结果；输入里没有 URL 时返回 null
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
        const id = parseQQ(rawUrl);
        return {
            platform,
            id,
            // 有 id 就给标准长链，插件按 disstid 解析最稳
            normalizedUrl: id
                ? `https://y.qq.com/n/ryqq/playlist/${id}`
                : rawUrl,
            rawUrl,
            rawText,
        };
    }

    if (platform === "netease") {
        const id = parseNetease(rawUrl);
        return {
            platform,
            id,
            normalizedUrl: id
                ? `https://music.163.com/playlist?id=${id}`
                : rawUrl,
            rawUrl,
            rawText,
        };
    }

    // 其他平台：原样透传，交给插件自己判断
    return {
        platform: "unknown",
        id: null,
        normalizedUrl: rawUrl,
        rawUrl,
        rawText,
    };
}

export const PLATFORM_LABEL: Record<SheetPlatform, string> = {
    qq: "QQ音乐",
    netease: "网易云音乐",
    unknown: "其他",
};

/**
 * 一次解析多个链接（用户可能一次粘贴多行分享文本）。
 * 保留输入顺序，跳过解析不出的项。
 */
export function parseMultipleSheetLinks(input: string): IParsedSheetLink[] {
    if (!input) {
        return [];
    }
    const urls = input.match(/https?:\/\/[^\s，,。；;、"'"''）)】\]]+/gi) ?? [];
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
