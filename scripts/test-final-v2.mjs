/**
 * 终极验收 v2：模拟 App 真实链路
 *
 *  App 侧两道防线都要覆盖：
 *   A) plugin.ts search() 过滤片段版单曲（4 平台：qq/netease/kuwo/kugou）
 *   B) playUrlProvider.getPlayUrlDirect + isFullAudio（QQ/网易云自研）
 *      插件兜底也过 isFullAudio
 *
 * 判定：单首音频估算时长 > 30 秒（HEAD Content-Length ≥ 1MB）
 * 平台：QQ / 网易云 / 酷狗 / 酷我（咪咕、汽水按用户要求不处理，不纳入）
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const _axMod = require(path.join(root, "node_modules", "axios"));
const axios = _axMod.default || _axMod;
if (axios.defaults) axios.defaults.timeout = 20000;

const out = path.join(root, "build", "final2-out");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
try {
    execFileSync("node", [path.join(root, "node_modules", "typescript", "bin", "tsc"),
        path.join(root, "src", "core", "playUrlProvider.ts"),
        "--target", "ES2022", "--module", "ES2022", "--moduleResolution", "bundler",
        "--skipLibCheck", "--outDir", out, "--rootDir", path.join(root, "src")], { cwd: root, stdio: "pipe" });
} catch {}
const pp = [path.join(out, "core", "playUrlProvider.js"), path.join(out, "playUrlProvider.js")].find(x => fs.existsSync(x));
const { getPlayUrlDirect, isFullAudio } = pp ? await import("file://" + pp.replace(/\\/g, "/")) : { getPlayUrlDirect: null, isFullAudio: null };

function loadPlugin(file) {
    const code = fs.readFileSync(path.join(root, "build", file), "utf8");
    const m = { exports: {} };
    const req = (name) => {
        if (name === "axios") return axios;
        if (name === "crypto-js") { const c = require("node:crypto"); return { MD5: s => ({ toString: () => c.createHash("md5").update(String(s)).digest("hex") }), enc: { Hex: {} }, lib: {} }; }
        if (name === "dayjs") { const d = () => ({ format: () => "" }); d.extend = () => {}; return d; }
        if (name === "cheerio") return { load: () => ({}) };
        if (name === "he") return { decode: s => String(s) };
        if (name === "qs") return { stringify: o => new URLSearchParams(o).toString() };
        if (name === "big-integer") return n => ({ toString: () => String(n) });
        return new Proxy({}, { get: () => () => ({}) });
    };
    const env = { getUserVariables: () => ({}), get userVariables() { return {}; }, appVersion: "25.3.0", os: "win32", lang: "zh-CN" };
    const proc = { platform: "win32", version: "25.3.0", env, ensurePluginInitialized: Promise.resolve() };
    try {
        new Function("require", "__musicfree_require", "module", "exports", "console", "env", "URL", "process", code)(
            req, req, m, m.exports, console, env, URL, proc,
        );
    } catch { return null; }
    const p = m.exports.default ?? m.exports;
    try { p._internal?.setChainDeadlineForTest?.(Date.now() + 60000); } catch {}
    return p;
}

/** 与 App plugin.ts search() 完全一致的过滤逻辑 */
function appSearchFilter(list, platform) {
    const PLATS = ["qq", "netease", "kuwo", "kugou"];
    if (!PLATS.includes(String(platform).toLowerCase())) return list;
    const isClip = (item) => {
        const title = String(item?.title ?? item?.name ?? "");
        if (/片段|试听|preview|\d+\s*秒|间奏|0\.\d+X|epic版|短视频版/i.test(title)) return true;
        const dur = Number(item?.duration);
        if (Number.isFinite(dur) && dur > 0 && dur < 60) return true;
        return false;
    };
    const filtered = list.filter(x => !isClip(x));
    return filtered.length > 0 ? filtered : list;
}

async function verify(url) {
    const h = await fetch(url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" } });
    const cl = Number(h.headers.get("content-length")) || 0;
    return {
        ok: h.status === 200 && cl >= 1024 * 1024,
        status: h.status, mb: (cl / 1048576).toFixed(2),
        secs: Math.round(cl / 16000), ct: h.headers.get("content-type") || "",
    };
}

const KEYWORDS = [
    "先说谎的人 h3R3", "吻得太逼真 张敬轩", "反方向的钟 周杰伦",
    "可惜没如果 林俊杰", "演员 薛之谦", "起风了 买辣椒也用券",
    "晴天 周杰伦", "稻香 周杰伦", "孤勇者 陈奕迅", "Blinding Lights",
    "夜曲 周杰伦", "光年之外 邓紫棋", "默 那英", "泡沫 邓紫棋",
];
// 只测用户指定的 4 个平台
const PLATS = [
    { file: "qq-plugin.js", name: "QQ音乐", id: "qq" },
    { file: "netease-plugin.js", name: "网易云", id: "netease" },
    { file: "kugou-plugin.js", name: "酷狗", id: "kugou" },
    { file: "kuwo-plugin.js", name: "酷我", id: "kuwo" },
];

console.log("=".repeat(76));
console.log("最终验收 v2：4 平台 × 14 首会员歌 ｜ 单首必须 > 30 秒");
console.log("（模拟 App search 片段过滤 + 自研取链 + isFullAudio）");
console.log("=".repeat(76));

let pass = 0, total = 0, clips = 0, fails = 0;
for (const cfg of PLATS) {
    const p = loadPlugin(cfg.file);
    if (!p) { console.log(`\n### ${cfg.name} 加载失败`); continue; }
    const lines = [];
    let lp = 0;
    for (const kw of KEYWORDS) {
        total++;
        let list = [];
        try { const r = await p.search(kw, 1, "music"); list = r?.data ?? []; } catch {}
        // App search 过滤
        list = appSearchFilter(list, cfg.id);
        const song = list[0];
        if (!song) { lines.push(`  ✗ [${kw}] 搜索无结果`); fails++; continue; }
        song.platform = cfg.id;
        song._srcOrder = song._srcOrder || [cfg.id];
        song.primaryKey = song.primaryKey || song.id;

        let url = null, via = "";
        if ((cfg.id === "qq" || cfg.id === "netease") && getPlayUrlDirect) {
            try {
                const r = await getPlayUrlDirect(
                    { id: song.id, platform: cfg.id, songmid: song.songmid }, "standard");
                if (r?.url) { url = r.url; via = "app"; }
            } catch {}
        }
        if (!url) {
            for (const q of ["standard", "128k", "320k", "high"]) {
                try {
                    p._internal?.setChainDeadlineForTest?.(Date.now() + 60000);
                    const r = await Promise.race([
                        p.getMediaSource(song, q),
                        new Promise((_, rj) => setTimeout(() => rj(new Error("t/o")), 18000)),
                    ]);
                    const u = typeof r === "string" ? r : r?.url;
                    if (u) {
                        // App 插件兜底层的 isFullAudio 校验
                        if (isFullAudio && !(await isFullAudio(u))) continue;
                        url = u; via = "plugin"; break;
                    }
                } catch {}
            }
        }
        if (!url) { lines.push(`  ✗ [${kw}] 无链接`); fails++; continue; }
        const v = await verify(url);
        if (v.ok) {
            lines.push(`  ✓ [${kw}] ${String(song.title).slice(0, 16).padEnd(17)} ${via} ${v.mb}MB ~${v.secs}s`);
            lp++; pass++;
        } else if (v.status === 200) {
            lines.push(`  ✗ [${kw}] ★片段★ ${v.mb}MB ~${v.secs}s  ${String(song.title).slice(0, 20)}`);
            clips++;
        } else { lines.push(`  ✗ [${kw}] HTTP ${v.status}`); fails++; }
    }
    console.log(`\n### ${cfg.name}  ${lp}/${KEYWORDS.length}`);
    lines.forEach(l => console.log(l));
}

console.log("\n" + "=".repeat(76));
console.log(`总计: ${pass}/${total} 首 > 30 秒完整音频`);
console.log(`      片段(<1MB): ${clips}  无链接/失败: ${fails}`);
console.log("=".repeat(76));
if (clips > 0 || fails > 0) { console.log("\n>>> 未全绿，禁止出包"); process.exit(2); }
else console.log("\n>>> 4 平台全绿，可以出包");
