/**
 * 已验证的接口（全部本地实测可下载真实音频）：
 *
 *  QQ 音乐 —— 桌面版 MusicFreeDesktop 同款「s01s 第三方通道」：
 *    GET https://tang.api.s01s.cn/music_open_api.php?mid=<songmid>
 *    → song_play_url_sq / song_play_url / song_play_url_standard ...
 *    直接给出已签发 vkey 的完整播放链接，vip=付费 的歌也有，
 *    实测《反方向的钟》《天后》《Whatever It Takes》均 HTTP 200 音频。
 *    官方 CgiGetVkey 恒 104003（需登录），已弃用。
 *
 *  网易云：
 *    GET /api/song/enhance/player/url?ids=[id]&br=320000
 *    → { data: [{ url, code, fee, size, br }] }
 *    code=200 且 url 非空 表示可播。
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
 * 从 QQ 音乐取播放链接 —— 对齐桌面版 MusicFreeDesktop 的真实做法。
 *
 * 背景（全部本地实测）：
 *   - 官方 musicu.fcg / CgiGetVkey 恒返回 result=104003（强制登录），
 *     付费歌拿不到 purl；
 *   - 桌面版能免登录播会员歌，抓包定位到它走第三方通道
 *     tang.api.s01s.cn（插件里叫 qqS01sMid / s01s mid 直查）；
 *   - 实测：GET https://tang.api.s01s.cn/music_open_api.php?mid=<songmid>
 *     直接返回所有音质的**已签发 vkey 的完整播放链接** + 歌词，
 *     且 vip=付费 的歌也有链接；
 *   - 验证《反方向的钟》：
 *       song_play_url_sq        → HTTP 200, audio/x-ogg,  27MB (FLAC)
 *       song_play_url           → HTTP 200, audio/mp4,   6.0MB (193kbps)
 *       song_play_url_standard  → HTTP 200, audio/mp4,   3.0MB
 *     《天后》《Whatever It Takes》同样 vip=付费 且都有 url。
 *
 * 这个接口就是桌面版「次合代第三方通道」的实现，纯 HTTP GET，
 * RN 的 fetch 可直接调用，不需要 request-forwarder、不需要登录。
 */
export async function getQQPlayUrl(
    songMid: string,
    quality = "standard",
): Promise<IPlayUrlResult | null> {
    if (!songMid) {
        return null;
    }

    // 音质 → s01s 响应里对应的字段（按优先级从高到低）
    const qualityFields: Record<string, string[]> = {
        super: ["song_play_url_sq", "song_play_url_pq", "song_play_url"],
        high: ["song_play_url_sq", "song_play_url", "song_play_url_hq"],
        standard: ["song_play_url", "song_play_url_hq", "song_play_url_standard"],
        low: ["song_play_url_standard", "song_play_url_fq", "song_play_url"],
        "320k": ["song_play_url", "song_play_url_hq"],
        "128k": ["song_play_url_standard", "song_play_url_fq"],
        flac: ["song_play_url_sq", "song_play_url_pq"],
    };
    const fields =
        qualityFields[quality] ??
        ["song_play_url", "song_play_url_hq", "song_play_url_standard"];

    try {
        const url = `https://tang.api.s01s.cn/music_open_api.php?mid=${encodeURIComponent(
            songMid,
        )}`;
        const resp = await fetch(url, {
            headers: {
                "User-Agent": UA_IOS,
                Referer: "https://y.qq.com/",
                Accept: "application/json",
            },
        });
        if (!resp.ok) {
            return null;
        }
        const json: any = await resp.json();

        // 依次挑一个非空链接
        for (const key of fields) {
            const u = json?.[key];
            if (typeof u === "string" && /^https?:\/\//.test(u)) {
                return {
                    url: u,
                    quality,
                    via: "qq-api",
                };
            }
        }

        // 兜底：扫描所有 song_play_url* 字段（接口新增音质时不会漏）
        for (const [k, v] of Object.entries(json ?? {})) {
            if (
                k.startsWith("song_play_url") &&
                typeof v === "string" &&
                /^https?:\/\//.test(v)
            ) {
                return { url: v, quality, via: "qq-api" };
            }
        }
        return null;
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
 * 把各种形态的 id 归一化成平台原生 id。
 *
 * App 里 musicItem.id 有几种来源：
 *   - 自研导入：纯 songmid（"003J4Xjo1NJvck"）/ 纯数字（"2747953391"）
 *   - 插件 search 返回：带平台前缀（"qq_003QPfKz3s91GC" /
 *                                   "netease_2668397359"）
 *   - 还可能是 "qq:xxx" / "netease|xxx"
 * 取链接口只认原生 id，这里统一剥掉前缀。
 */
export function normalizeSongId(rawId: string, source: "netease" | "qq"): string {
    let s = String(rawId ?? "").trim();
    // 剥掉 "qq_" / "netease_" / "qq:" / "163_" 等前缀
    s = s.replace(/^(qq|netease|163|wy)[_:|\-]/i, "");
    // 若仍是 "平台-xxx" 形态
    s = s.replace(/^(qq|netease)[-]/i, "");
    return s;
}

/**
 * 统一入口：优先自研接口，失败返回 null 交给插件兜底。
 */
export async function getPlayUrlDirect(
    musicItem: { id: string; platform: string; songmid?: string },
    quality = "standard",
): Promise<IPlayUrlResult | null> {
    const source = detectPlaySource(musicItem.platform);

    // 优先用 songmid（QQ 插件 search 自带），否则从 id 归一化
    const rawId = musicItem.songmid || musicItem.id;
    const songId = normalizeSongId(rawId, source === "qq" ? "qq" : "netease");
    if (!songId) {
        return null;
    }

    if (source === "netease") {
        // 依次尝试各音质（免费歌可能只有低音质）
        for (const q of [quality, "standard", "high", "low"]) {
            const r = await getNeteasePlayUrl(songId, q);
            if (r) {
                return r;
            }
        }
        return null;
    }

    if (source === "qq") {
        for (const q of [quality, "standard", "high", "low"]) {
            const r = await getQQPlayUrl(songId, q);
            if (r) {
                return r;
            }
        }
        return null;
    }

    return null;
}
