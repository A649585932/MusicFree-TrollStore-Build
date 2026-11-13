/**
 * 本地实测 sheetImporter —— 用 tsc 编译成真实 JS 后执行
 *
 * 用法：node scripts/test-sheet-importer2.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const src = path.join(root, "src", "core", "sheetImporter.ts");
const outDir = path.join(root, "build", "importer-out");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

console.log("用 tsc 编译 sheetImporter.ts ...");
try {
    execFileSync(
        "node",
        [
            path.join(root, "node_modules", "typescript", "bin", "tsc"),
            src,
            "--target", "ES2022",
            "--module", "ES2022",
            "--moduleResolution", "bundler",
            "--skipLibCheck",
            "--outDir", outDir,
        ],
        { cwd: root, stdio: "pipe" },
    );
    console.log("  编译完成");
} catch (e) {
    console.error("  编译失败:", e.stdout?.toString() || e.message);
    process.exit(1);
}

const compiled = fs
    .readdirSync(outDir)
    .find(f => f.endsWith(".js"));
if (!compiled) {
    console.error("找不到编译产物");
    process.exit(1);
}

const modPath = "file://" + path.join(outDir, compiled).replace(/\\/g, "/");
const mod = await import(modPath);
const { importSheetDirect, extractNeteaseId, extractQQId, detectSource } = mod;

const CASES = [
    {
        name: "网易云 带 uct2（用户实际链接）",
        input:
            "https://music.163.com/playlist?id=365054063&uct2=U2FsdGVkX18/qgUgPDYWoorxhjMEkUNVdQlWGDECwAU=",
    },
    { name: "网易云 纯 id", input: "365054063" },
    { name: "QQ 真实 id（短链跳转后的，指定平台）", input: "9774303959", preferred: "qq" },
    { name: "QQ 长链", input: "https://y.qq.com/n/ryqq/playlist/9774303959" },
];

console.log("\n=== 工具函数 ===");
console.log("  detectSource(163) =", detectSource("https://music.163.com/playlist?id=1"));
console.log("  detectSource(qq)  =", detectSource("https://y.qq.com/x"));
console.log("  extractNeteaseId  =", extractNeteaseId("https://music.163.com/playlist?id=365054063&uct2=xx"));
console.log("  extractQQId       =", extractQQId("https://y.qq.com/n/ryqq/playlist/9774303959"));

let pass = 0;
let fail = 0;

for (const c of CASES) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`用例: ${c.name}`);
    console.log(`输入: ${c.input}`);
    try {
        const t0 = Date.now();
        const r = await importSheetDirect(c.input, c.preferred);
        const ms = Date.now() - t0;
        console.log(`  歌单名   : ${r.sheetName}`);
        console.log(`  来源     : ${r.source}`);
        console.log(`  歌曲数   : ${r.songs.length}  (耗时 ${ms}ms)`);
        if (r.songs.length) {
            const a = r.songs[0];
            console.log(`  样例1    : ${a.title} - ${a.artist} (${a.duration}s)`);
            if (r.songs[1]) {
                const b = r.songs[1];
                console.log(`  样例2    : ${b.title} - ${b.artist} (${b.duration}s)`);
            }
            console.log("  ✓ 成功");
            pass++;
        } else {
            console.log("  ✗ 0 首");
            fail++;
        }
    } catch (e) {
        console.log(`  ✗ ${e?.message ?? e}`);
        fail++;
    }
}

console.log(`\n${"=".repeat(60)}`);
console.log(`结果: ${pass} 成功 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
