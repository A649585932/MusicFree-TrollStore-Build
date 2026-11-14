/**
 * App 侧自研取播放链接（不依赖插件的 getMediaSource）
 *
 * 背景：
 *   实测 padao 的网易云 / QQ 插件 getMediaSource 全部返回
 *   「聚合取链失败：所有可用源均未取得播放链接」，
 *   但平台自己的公开接口**完全可用**（实测拿到 audio/mpeg、7.5MB 音频）。
 *
 * 所以这里自己做取链，插件只作为兜底。
 *
 * 已验证的接口：
 *   网易云  /api/song/enhance/player/url?ids=[id]&br=320000
 *           → { data: [{ url, code, fee, size, br }] }
 *           code=200 且 url 非空 表示可播；code=-110 表示 VIP 受限
 */

export interface IPlayUrlResult {
    url: string;
    quality?: string;
    size?: number;
    /** 数据来源，便于排查 */
    via: "netease-api" | "qq-api" | "plugin";
}

const UA_IOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1";

/** 音质 → 网易云 br 参数 */
const NETease_BR: Record<string, number> = {
    low: 128000,
    standard: 192000,
    high: 320000,
    super: 999000,
};

/**
 * 从网易云取播放链接。
 *
 * @param songId 歌曲 id（纯数字）
 * @param quality 音质偏好
 */
export async function getNeteasePlayUrl(
    songId: string,
    quality = "standard",
): Promise<IPlayUrlResult | null> {
    const br = NETease_BR[quality] ?? 320000;
    const url = `https://music.163.com/api/song/enhance/player/url?ids=[${encodeURIComponent(
        songId,
    )}]&br=${br}`;

    try {
        const resp = await fetch(url, {
            headers: {
                "User-Agent": UA_IOS,
                Referer: "https://music.163.com/",
                Accept: "application/json",
            },
        });
        if (!resp.ok) {
            return null;
        }
        const json: any = await resp.json();
        const d = json?.data?.[0];
        if (!d?.url) {
            // code=-110 表示 VIP/版权受限，静默返回 null
            return null;
        }
        return {
            url: String(d.url),
            quality,
            size: typeof d.size === "number" ? d.size : undefined,
            via: "netease-api",
        };
    } catch {
        return null;
    }
}

/**
 * 从 QQ 音乐取播放链接。
 *
 * QQ 的取链需要先拿 vkey，再拼成 http://dl.stream.qqmusic.qq.com/...
 * 这里用公开的 musicu.fcg 接口。
 */
export async function getQQPlayUrl(
    songMid: string,
    quality = "standard",
): Promise<IPlayUrlResult | null> {
    // QQ 音质标识
    const prefixMap: Record<string, string> = {
        low: "M500",
        standard: "M800",
        high: "M800",
        super: "RS01",
    };
    const prefix = prefixMap[quality] ?? "M800";

    const payload = {
        req_0: {
            module: "vkey.GetVkeyServer",
            method: "CgiGetVkey",
            param: {
                guid: "10000",
                songmid: [songMid],
                songtype: [0],
                uin: "0",
                loginflag: 1,
                platform: "20",
            },
        },
        comm: { uin: "0", format: "json", ct: 24, cv: 0 },
    };

    try {
        const resp = await fetch(
            "https://u.y.qq.com/cgi-bin/musicu.fcg?format=json",
            {
                method: "POST",
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                    Referer: "https://y.qq.com/",
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(payload),
            },
        );
        if (!resp.ok) {
            return null;
        }
        const json: any = await resp.json();
        const data = json?.req_0?.data;
        const midurlinfo = data?.midurlinfo?.[0];
        const purl = midurlinfo?.purl;
        if (!purl) {
            return null;
        }
        const sip = data?.sip?.[0] ?? "http://dl.stream.qqmusic.qq.com/";
        const fullUrl = sip.endsWith("/") ? sip + purl : sip + "/" + purl;
        return {
            url: fullUrl,
            quality,
            via: "qq-api",
        };
    } catch {
        return null;
    }
}

/** 根据 platform（插件名或平台标识）判断用哪个取链实现 */
export function detectPlaySource(platform: string): "netease" | "qq" | "unknown" {
    const p = (platform ?? "").toLowerCase();
    if (p.includes("网易") || p.includes("netease") || p.includes("163")) {
        return "netease";
    }
    if (p.includes("qq")) {
        return "qq";
    }
    return "unknown";
}

/**
 * 统一入口：优先自研接口，失败返回 null 交给插件兜底。
 */
export async function getPlayUrlDirect(
    musicItem: { id: string; platform: string },
    quality = "standard",
): Promise<IPlayUrlResult | null> {
    const source = detectPlaySource(musicItem.platform);

    if (source === "netease") {
        // 依次尝试各音质（免费歌可能只有低音质）
        for (const q of [quality, "standard", "high", "low"]) {
            const r = await getNeteasePlayUrl(musicItem.id, q);
            if (r) {
                return r;
            }
        }
        return null;
    }

    if (source === "qq") {
        for (const q of [quality, "standard", "high", "low"]) {
            const r = await getQQPlayUrl(musicItem.id, q);
            if (r) {
                return r;
            }
        }
        return null;
    }

    return null;
}
