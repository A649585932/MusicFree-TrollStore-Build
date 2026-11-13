/**
 * QQ 短链完整链路本地测试
 *
 * 用法：node scripts/test-qq-shortlink.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(root, "build", "qq-test-out");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

try {
    execFileSync(
        "node",
        [
            path.join(root, "node_modules", "typescript", "bin", "tsc"),
            path.join(root, "src", "core", "sheetImporter.ts"),
            path.join(root, "src", "utils", "resolveShortLink.ts"),
            "--target", "ES2022",
            "--module", "ES2022",
            "--moduleResolution", "bundler",
            "--skipLibCheck",
            "--outDir", outDir,
            "--rootDir", path.join(root, "src"),
        ],
        { cwd: root, stdio: "pipe" },
    );
    console.log("编译完成");
} catch (e) {
    console.log("编译警告:", (e.stdout || e.message || "").toString().slice(0, 300));
}

// tsc 不会给相对 import 补 .js，ESM 运行时需要显式扩展名
const impJs = path.join(outDir, "core", "sheetImporter.js");
if (fs.existsSync(impJs)) {
    let t = fs.readFileSync(impJs, "utf8");
    t = t.replace(
        'from "../utils/resolveShortLink"',
        'from "../utils/resolveShortLink.js"',
    );
    fs.writeFileSync(impJs, t, "utf8");
}

const shortJs = path.join(outDir, "utils", "resolveShortLink.js");
for (const f of [impJs, shortJs]) {
    if (!fs.existsSync(f)) {
        console.error("缺少编译产物:", f);
        process.exit(1);
    }
}

const importer = await import("file://" + impJs.replace(/\\/g, "/"));
const short = await import("file://" + shortJs.replace(/\\/g, "/"));

const { detectSource, extractQQId, importSheetDirect } = importer;
const { followRedirects, isShortLink } = short;

const SHORT = "https://c6.y.qq.com/base/fcgi-bin/u?__=oEa1VXNj9ymM";

console.log("=".repeat(62));
console.log("步骤 1: 短链判定");
console.log("  isShortLink =", isShortLink(SHORT));

console.log("\n步骤 2: 跟随跳转");
let finalUrl = null;
try {
    finalUrl = await followRedirects(SHORT);
    console.log("  finalUrl =", finalUrl);
} catch (e) {
    console.log("  ✗ 跳转失败:", e?.message);
}

console.log("\n步骤 3: 从最终 URL 提取");
if (finalUrl) {
    console.log("  detectSource =", detectSource(finalUrl));
    console.log("  extractQQId  =", extractQQId(finalUrl));
}

console.log("\n步骤 4: 最终 URL 直接导入");
if (finalUrl) {
    try {
        const r = await importSheetDirect(finalUrl);
        console.log(`  ✓ 《${r.sheetName}》${r.songs.length} 首`);
        if (r.songs[0]) {
            console.log(`    样例: ${r.songs[0].title} - ${r.songs[0].artist}`);
        }
    } catch (e) {
        console.log("  ✗", e?.message);
    }
}

console.log("\n步骤 5: 纯 ID 导入");
try {
    const r = await importSheetDirect("9774303959", "qq");
    console.log(`  ✓ 《${r.sheetName}》${r.songs.length} 首`);
} catch (e) {
    console.log("  ✗", e?.message);
}

console.log("\n步骤 6: ★ 原始短链整体导入（模拟用户粘贴）");
let pass6 = false;
try {
    const r = await importSheetDirect(SHORT);
    console.log(`  ✓ 《${r.sheetName}》${r.songs.length} 首`);
    pass6 = r.songs.length > 0;
} catch (e) {
    console.log("  ✗", e?.message);
}

console.log("\n" + "=".repeat(62));
console.log(pass6 ? "步骤 6 通过 —— 可以粘短链直接导入" : "步骤 6 失败 —— 仍需修复");
process.exit(pass6 ? 0 : 1);
