/**
 * 歌单导入：App 侧自实现（不依赖插件的 importMusicSheet）
 *
 * 为什么需要这个：
 *   实测 padao 的 QQ / 网易云插件 importMusicSheet 已经失效——
 *     - QQ: 无论短链、长链、纯 ID，插件都返回"歌单为空或拉取失败"
 *     - 网易云: 插件用 eapi 加密接口，网易云改了签名规则，返回 playlist not found
 *   而平台自己的公开接口仍然可用（实测网易云 v6 一次返回 425 首）。
 *
 * 因此这里直接调平台接口，把结果转换成 MusicFree 的 IMusicItem 结构，
 * 插件只作为兜底（万一哪天插件修好了）。
 */
import { followRedirects, isShortLink as _isShortLink } from "../utils/resolveShortLink";


export type SheetSource = "netease" | "qq" | "unknown";

export interface INormalizedSong {
    /** 平台内 id */
    id: string;
    title: string;
    artist: string;
    album?: string;
    /** 秒 */
    duration?: number;
    artwork?: string;
    /** 原始数据，便于调试 */
    raw?: any;
}

export interface IImportResult {
    source: SheetSource;
    sheetName: string;
    songs: INormalizedSong[];
    trackCount?: number;
}

const UA_IOS =
    "Mozilla/5.0 (iPhone; CPU iPhone OS 16_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.1 Mobile/15E148 Safari/604.1";

/** 从任意输入提取网易云歌单 id */
export function extractNeteaseId(input: string): string | null {
    const text = (input ?? "").trim();
    if (/^\d{4,}$/.test(text)) {
        return text;
    }
    const patterns = [
        /[?&]id=(\d+)/i,
        /\/playlist\/(\d+)/i,
        /\/discover\/toplist\/(\d+)/i,
        /playlist\?id=(\d+)/i,
    ];
    for (const p of patterns) {
        const m = text.match(p);
        if (m) {
            return m[1];
        }
    }
    return null;
}

/** 从任意输入提取 QQ 歌单 id */
export function extractQQId(input: string): string | null {
    const text = (input ?? "").trim();
    if (/^\d{4,}$/.test(text)) {
        return text;
    }
    const patterns = [
        /[?&]disstid=(\d+)/i,
        /\/playlist\/(\d+)/i,
        /taoge\.html[^#]*[?&]id=(\d+)/i,
        /[?&]id=(\d+)/i,
    ];
    for (const p of patterns) {
        const m = text.match(p);
        if (m) {
            return m[1];
        }
    }
    return null;
}

/** 判断输入属于哪个平台 */
export function detectSource(input: string): SheetSource {
    const u = (input ?? "").toLowerCase();
    if (u.includes("163.com") || u.includes("163cn.tv") || u.includes("music.163")) {
        return "netease";
    }
    if (u.includes("qq.com")) {
        return "qq";
    }
    // 纯数字无法判断，交给调用方按插件名猜
    return "unknown";
}

/* ------------------------------------------------------------------ */
/* 网易云                                                              */
/* ------------------------------------------------------------------ */

/**
 * 拉取网易云歌单。
 *
 * 实测接口（2026-11）：
 *   /api/v6/playlist/detail?id=xxx  → code 200，返回 tracks + trackIds
 *   /api/playlist/detail?id=xxx     → code 20001（需要登录，别用）
 *
 * 注意：v6 接口的 playlist.tracks 只返回**前若干首**（实测 6 首），
 * 完整列表在 playlist.trackIds 里。所以需要再按 trackIds 批量取详情。
 */
export async function fetchNeteaseSheet(
    sheetId: string,
): Promise<IImportResult> {
    const detailUrl = `https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(
        sheetId,
    )}`;

    const resp = await fetch(detailUrl, {
        headers: {
            "User-Agent": UA_IOS,
            Referer: "https://music.163.com/",
            Accept: "application/json",
        },
    });
    if (!resp.ok) {
        throw new Error(`网易云接口 HTTP ${resp.status}`);
    }
    const json: any = await resp.json();
    if (json?.code !== 200 || !json?.playlist) {
        throw new Error(`网易云返回 code=${json?.code}（歌单可能不存在或需要登录）`);
    }

    const pl = json.playlist;
    const inlineTracks: any[] = Array.isArray(pl.tracks) ? pl.tracks : [];
    const trackIds: any[] = Array.isArray(pl.trackIds) ? pl.trackIds : [];

    let allTracks = inlineTracks;

    // trackIds 比 inline tracks 多 → 说明需要补拉
    if (trackIds.length > inlineTracks.length) {
        const ids = trackIds
            .map(t => t?.id)
            .filter((x: any) => x != null)
            .map(String);

        // 分批 500 首一次
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += 500) {
            chunks.push(ids.slice(i, i + 500));
        }

        const extra: any[] = [];
        for (const chunk of chunks) {
            try {
                const dUrl =
                    `https://music.163.com/api/song/detail/?ids=[${chunk
                        .map(i => `"${i}"`)
                        .join(",")}]`;
                const dResp = await fetch(dUrl, {
                    headers: {
                        "User-Agent": UA_IOS,
                        Referer: "https://music.163.com/",
                    },
                });
                if (!dResp.ok) {
                    continue;
                }
                const dJson: any = await dResp.json();
                if (Array.isArray(dJson?.songs)) {
                    extra.push(...dJson.songs);
                }
            } catch {
                // 单批失败不影响其他批
            }
        }

        if (extra.length > inlineTracks.length) {
            allTracks = extra;
        }
    }

    const songs: INormalizedSong[] = allTracks.map((t: any) => ({
        id: String(t.id),
        title: t.name ?? "",
        artist:
            (t.ar ?? t.artists ?? []).map((a: any) => a.name).join("/") ||
            "未知歌手",
        album: t.al?.name ?? t.album?.name ?? undefined,
        duration:
            typeof t.dt === "number"
                ? Math.round(t.dt / 1000)
                : typeof t.duration === "number"
                  ? Math.round(t.duration / 1000)
                  : undefined,
        artwork: t.al?.picUrl ?? t.album?.picUrl ?? undefined,
        raw: t,
    }));

    return {
        source: "netease",
        sheetName: pl.name ?? `网易云歌单 ${sheetId}`,
        songs,
        trackCount: pl.trackCount ?? songs.length,
    };
}

/* ------------------------------------------------------------------ */
/* QQ 音乐                                                             */
/* ------------------------------------------------------------------ */

/**
 * 拉取 QQ 音乐歌单。
 *
 * 用公开的 fcgi 接口拿 songlist，再批量取歌曲详情。
 * 说明：QQ 的接口对 UA / Referer 比较敏感，这里都按 PC 网页版给。
 */
export async function fetchQQSheet(sheetId: string): Promise<IImportResult> {
    const headers: Record<string, string> = {
        "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Referer: "https://y.qq.com/",
        Accept: "application/json, text/plain, */*",
    };

    // 1) 歌单基本信息 + 歌曲列表
    const detailUrl =
        "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg" +
        `?type=1&json=1&utf8=1&onlysong=0&disstid=${encodeURIComponent(sheetId)}` +
        "&format=json&g_tk=5381&loginUin=0&hostUin=0&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0";

    const resp = await fetch(detailUrl, { headers });
    if (!resp.ok) {
        throw new Error(`QQ 接口 HTTP ${resp.status}`);
    }
    const text = await resp.text();

    // QQ 返回可能是 json 或 jsonp
    let json: any;
    try {
        json = JSON.parse(text);
    } catch {
        const m = text.match(/^\w+\((.*)\);?$/s);
        if (!m) {
            throw new Error("QQ 返回格式无法解析");
        }
        json = JSON.parse(m[1]);
    }

    if (json?.code !== 0 && json?.code !== 200) {
        throw new Error(`QQ 返回 code=${json?.code}`);
    }

    const cd = json?.cdlist?.[0];
    if (!cd) {
        throw new Error("QQ 歌单不存在或已被删除");
    }

    const rawSongs: any[] = Array.isArray(cd.songlist) ? cd.songlist : [];

    const songs: INormalizedSong[] = rawSongs
        .map(s => {
            // QQ 字段：songmid / songname / singer(对象) / albumname / albummid / interval
            const mid = s?.songmid ?? s?.mid ?? s?.strMediaMid;
            if (!mid) {
                return null;
            }
            // singer 可能是对象或数组
            let singers = "";
            if (Array.isArray(s?.singer)) {
                singers = s.singer
                    .map((x: any) => x?.name)
                    .filter(Boolean)
                    .join("/");
            } else if (s?.singer && typeof s.singer === "object") {
                singers = s.singer.name ?? "";
            } else if (typeof s?.singer === "string") {
                singers = s.singer;
            }
            const albumMid = s?.albummid ?? s?.album?.mid;
            return {
                id: String(mid),
                title: s.songname ?? s.name ?? s.title ?? "",
                artist: singers || "未知歌手",
                album: s.albumname ?? s.album?.name ?? undefined,
                duration:
                    typeof s.interval === "number" ? s.interval : undefined,
                artwork: albumMid
                    ? "https://y.gtimg.cn/music/photo_new/T002R300x300M000" +
                      albumMid +
                      ".jpg"
                    : undefined,
                raw: s,
            } as INormalizedSong;
        })
        .filter(Boolean) as INormalizedSong[];

    return {
        source: "qq",
        sheetName: cd.dissname ?? `QQ 歌单 ${sheetId}`,
        songs,
        trackCount: cd.songcount ?? songs.length,
    };
}

/* ------------------------------------------------------------------ */
/* 统一入口                                                            */
/* ------------------------------------------------------------------ */

/**
 * 按输入自动判断平台并导入。
 *
 * @param input 用户粘贴的链接 / 分享文案 / 纯数字 id
 * @param preferred 当输入是纯数字、无法判断平台时的偏好
 */
/**
 * 短链跟随跳转。
 *
 * 复用 utils/resolveShortLink 的实现（XMLHttpRequest 版），
 * 因为 React Native 里只有 XHR 能可靠读到 3xx 的 location 头：
 *   - axios + maxRedirects:0 → 拿不到 location
 *   - fetch + redirect:"manual" → location 被 CORS 过滤
 *   - XMLHttpRequest.getAllResponseHeaders() → 可行
 *
 * 本地测试（Node）会自动回退到 fetch，两边都能跑。
 */
async function followShortLink(url: string): Promise<string | null> {
    try {
        return await followRedirects(url);
    } catch {
        return url;
    }
}

/** 短链特征判定 */
function looksLikeShortLink(url: string): boolean {
    return _isShortLink(url);
}

export async function importSheetDirect(
    input: string,
    preferred?: SheetSource,
): Promise<IImportResult> {
    let target = (input ?? "").trim();
    const originalInput = target;

    console.log("[sheetImport] 输入:", target);
    console.log("[sheetImport] isShortLink:", looksLikeShortLink(target));

    let source =
        detectSource(target) === "unknown"
            ? preferred ?? "netease"
            : detectSource(target);

    // ---- 第一步：短链跟随跳转，拿到真实地址 ----
    if (looksLikeShortLink(target)) {
        const real = await followShortLink(target);
        console.log("[sheetImport] 跳转后:", real);
        if (real && real !== target) {
            target = real;
            const s2 = detectSource(real);
            if (s2 !== "unknown") {
                source = s2;
            }
        }
        // 即使 URL 没变，也从原链接里再抽一次 id（有些短链服务直接在
        // query 里带 id，比如 ?id=9774303959）
        if (extractQQId(target) === null && extractNeteaseId(target) === null) {
            const fromOriginal = extractQQId(originalInput);
            if (fromOriginal) {
                target = fromOriginal;
                console.log("[sheetImport] 从原链接提取 id:", fromOriginal);
            }
        }
    }

    console.log("[sheetImport] 解析目标:", target, "平台:", source);

    // ---- 第二步：按平台提取 id 并拉取 ----
    if (source === "netease") {
        const id = extractNeteaseId(target);
        console.log("[sheetImport] 网易云 id:", id);
        if (!id) {
            throw new Error(
                "没能从链接里识别出网易云歌单 ID。请试粘贴含 playlist?id= 的完整链接",
            );
        }
        return fetchNeteaseSheet(id);
    }

    if (source === "qq") {
        const id = extractQQId(target);
        console.log("[sheetImport] QQ id:", id);
        if (!id) {
            throw new Error(
                "没能识别出 QQ 歌单 ID。短链可能被平台限制，请打开分享页复制完整链接，或直接输入歌单数字 ID",
            );
        }
        return fetchQQSheet(id);
    }

    throw new Error("不支持该平台的歌单链接");
}
