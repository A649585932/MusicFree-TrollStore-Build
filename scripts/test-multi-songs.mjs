/**
 * 多首收费歌 × 全平台 取链压测
 *
 * 两个维度：
 *  A) 插件自身 getMediaSource（App 里非 QQ/网易云 平台走这条回退）
 *  B) App 的 getPlayUrlDirect（QQ/网易云 走自研）
 *
 * 每首歌都 HEAD 验证真实音频。
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

// 编译 playUrlProvider（App 自研取链）
const out = path.join(root, "build", "multi-out");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
try {
    execFileSync("node", [
        path.join(root, "node_modules", "typescript", "bin", "tsc"),
        path.join(root, "src", "core", "playUrlProvider.ts"),
        "--target", "ES2022", "--module", "ES2022", "--moduleResolution", "bundler",
        "--skipLibCheck", "--outDir", out, "--rootDir", path.join(root, "src"),
    ], { cwd: root, stdio: "pipe" });
} catch {}
const pPath = [path.join(out, "core", "playUrlProvider.js"), path.join(out, "playUrlProvider.js")].find(p => fs.existsSync(p));
const { getPlayUrlDirect } = pPath ? await import("file://" + pPath.replace(/\\/g, "/")) : { getPlayUrlDirect: null };

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
    } catch (e) { return null; }
    const p = m.exports.default ?? m.exports;
    try { p._internal?.setChainDeadlineForTest?.(Date.now() + 30000); } catch {}
    return p;
}

async function headOk(u) {
    try {
        const h = await fetch(u, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" } });
        const ct = h.headers.get("content-type") || "";
        const len = Number(h.headers.get("content-length")) || 0;
        return { ok: h.status === 200 && /audio|mpeg|mp4|octet|ogg|flac/i.test(ct), status: h.status, ct, mb: (len / 1048576).toFixed(1) };
    } catch (e) { return { ok: false, reason: e?.message }; }
}

// 每个平台用自己 search 出一首歌，再取链；再多换几首关键词
const KEYWORDS = ["反方向的钟 周杰伦", "可惜没如果 林俊杰", "演员 薛之谦", "起风了 买辣椒也用券", "Blinding Lights", "稻香 周杰伦"];
const PLATS = [
    { file: "qq-plugin.js", name: "QQ音乐", appOwn: true, platId: "qq" },
    { file: "kuwo-plugin.js", name: "酷我音乐", appOwn: false },
    { file: "kugou-plugin.js", name: "酷狗音乐", appOwn: false },
    { file: "migu-plugin.js", name: "咪咕音乐", appOwn: false },
    { file: "netease-plugin.js", name: "网易云", appOwn: true, platId: "netease" },
    { file: "qishui-plugin.js", name: "汽水音乐", appOwn: false },
];

console.log("=".repeat(74));
console.log("多首收费歌 × 全平台 取链压测（每首 HEAD 验证真实音频）");
console.log("=".repeat(74));

let totalPass = 0, totalCase = 0;
for (const cfg of PLATS) {
    const p = loadPlugin(cfg.file);
    if (!p) { console.log(`\n[--] ${cfg.name}: 插件加载失败`); continue; }
    console.log(`\n### ${cfg.name} (${p.platform})`);

    let pass = 0, tried = 0;
    for (const kw of KEYWORDS.slice(0, 4)) {
        tried++;
        totalCase++;
        let song = null;
        try { const r = await p.search(kw, 1, "music"); song = r?.data?.[0] ?? null; } catch {}
        if (!song) { console.log(`  [${kw}] 搜索无结果`); continue; }
        song.platform = p.platform;
        song._srcOrder = song._srcOrder || [p.platform];
        song.primaryKey = song.primaryKey || song.id;

        let url = null, via = "";
        // App 自研路径（QQ/网易云）
        if (cfg.appOwn && getPlayUrlDirect) {
            try {
                const r = await getPlayUrlDirect({ id: song.id, platform: cfg.platId }, "standard");
                if (r?.url) { url = r.url; via = "app-direct"; }
            } catch {}
        }
        // 插件回退路径
        if (!url) {
            for (const q of ["standard", "128k", "320k", "high"]) {
                try {
                    p._internal?.setChainDeadlineForTest?.(Date.now() + 30000);
                    const r = await Promise.race([
                        p.getMediaSource(song, q),
                        new Promise((_, rj) => setTimeout(() => rj(new Error("t/o")), 18000)),
                    ]);
                    const u = typeof r === "string" ? r : r?.url;
                    if (u) { url = u; via = "plugin"; break; }
                } catch {}
            }
        }
        if (!url) { console.log(`  [${kw}] ✗ 无链接 (${song.title})`); continue; }
        const v = await headOk(url);
        const icon = v.ok ? "✓" : "✗";
        console.log(`  [${icon}] ${kw} → ${song.title}  ${via}  ${v.status || ""} ${v.ct || ""} ${v.mb || ""}MB`);
        if (v.ok) { pass++; totalPass++; }
    }
    console.log(`  小计: ${pass}/${tried}`);
}

console.log("\n" + "=".repeat(74));
console.log(`总计: ${totalPass}/${totalCase} 首收费歌拿到可播放真实音频`);
console.log("=".repeat(74));
