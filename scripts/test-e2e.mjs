/**
 * 端到端本地验证：导入 → 取播放链接 → 验证可下载
 *
 * 严格模拟 App 里 trackPlayer 的新逻辑：
 *   1. importSheetDirect 拉歌单
 *   2. 构造 musicItem（platform = 插件名）
 *   3. getPlayUrlDirect 取链接（自研）
 *   4. HEAD + 部分下载验证真的是音频
 *
 * 用法：node scripts/test-e2e.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(root, "build", "e2e-out");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

try {
    execFileSync("node", [
        path.join(root, "node_modules", "typescript", "bin", "tsc"),
        path.join(root, "src", "core", "sheetImporter.ts"),
        path.join(root, "src", "core", "playUrlProvider.ts"),
        path.join(root, "src", "utils", "resolveShortLink.ts"),
        "--target", "ES2022", "--module", "ES2022",
        "--moduleResolution", "bundler", "--skipLibCheck",
        "--outDir", outDir, "--rootDir", path.join(root, "src"),
    ], { cwd: root, stdio: "pipe" });
    console.log("编译完成\n");
} catch (e) { /* 忽略 */ }

// 修 ESM 扩展名
for (const f of ["core/sheetImporter.js"]) {
    const p = path.join(outDir, f);
    if (fs.existsSync(p)) {
        let t = fs.readFileSync(p, "utf8");
        t = t.replace('from "../utils/resolveShortLink"', 'from "../utils/resolveShortLink.js"');
        fs.writeFileSync(p, t, "utf8");
    }
}

const imp = await import("file://" + path.join(outDir, "core", "sheetImporter.js").replace(/\\/g, "/"));
const play = await import("file://" + path.join(outDir, "core", "playUrlProvider.js").replace(/\\/g, "/"));

const { importSheetDirect } = imp;
const { getPlayUrlDirect } = play;

/** 插件名映射（模拟 resolvePluginName 的结果） */
const PLATFORM_NAME = {
    netease: "网易云音乐",
    qq: "QQ音乐",
};

async function testOne(label, input) {
    console.log("=".repeat(66));
    console.log(label);
    console.log(`输入: ${input.slice(0, 66)}`);
    console.log("=".repeat(66));

    // 1) 拉歌单
    let result;
    try {
        result = await importSheetDirect(input);
    } catch (e) {
        console.log(`  ✗ 拉歌单失败: ${e?.message}\n`);
        return { ok: false, stage: "sheet" };
    }
    console.log(`  ① 《${result.sheetName}》 ${result.songs.length} 首`);

    const platformName = PLATFORM_NAME[result.source] ?? result.source;
    console.log(`  ② platform = "${platformName}"`);

    // 2) 挑第一首能播的（跳过 VIP）
    let tested = 0;
    let succeed = 0;

    for (const song of result.songs.slice(0, 8)) {
        tested++;
        const item = { id: song.id, platform: platformName };
        let url = null;
        try {
            const r = await getPlayUrlDirect(item, "standard");
            url = r?.url ?? null;
        } catch { }

        if (!url) {
            console.log(`     [${tested}] ${song.title.slice(0, 18)} — 无链接（VIP/受限）`);
            continue;
        }

        // 验证真的能下载
        try {
            const resp = await fetch(url, {
                method: "GET",
                headers: { "User-Agent": "Mozilla/5.0", Range: "bytes=0-65535" },
            });
            const buf = await resp.arrayBuffer();
            const ct = resp.headers.get("content-type") ?? "";
            const isAudio = ct.includes("audio") || ct.includes("mpeg") || ct.includes("m4a");
            // 检查 ID3 或 MPEG 帧头
            const b = new Uint8Array(buf);
            const magic = Array.from(b.slice(0, 4)).map(x => x.toString(16).padStart(2, "0")).join(" ");
            const isID3 = b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
            const isFrame = b[0] === 0xff && (b[1] & 0xe0) === 0xe0;

            console.log(`     [${tested}] ✓ ${song.title.slice(0, 18)}`);
            console.log(`          ${ct}  ${buf.byteLength} 字节`);
            console.log(`          magic: ${magic}  ID3=${isID3} MPEG帧=${isFrame}`);
            if (isAudio && (isID3 || isFrame)) {
                succeed++;
            }
        } catch (e) {
            console.log(`     [${tested}] ${song.title.slice(0, 18)} — 下载失败: ${e?.message}`);
        }

        if (succeed >= 2) break;  // 验 2 首够了
    }

    console.log(`\n  结果: 测 ${tested} 首，成功 ${succeed} 首\n`);
    return { ok: succeed > 0, stage: "play", tested, succeed };
}

const r1 = await testOne(
    "【网易云】你的歌单",
    "https://music.163.com/playlist?id=365054063&uct2=U2FsdGVkX18/qgUgPDYWoorxhjMEkUNVdQlWGDECwAU=",
);

const r2 = await testOne(
    "【QQ】你的短链",
    "https://c6.y.qq.com/base/fcgi-bin/u?__=oEa1VXNj9ymM",
);

console.log("=".repeat(66));
console.log("总结");
console.log(`  网易云: ${r1.succeed ?? 0} 首可播`);
console.log(`  QQ    : ${r2.succeed ?? 0} 首可播`);
console.log("=".repeat(66));
