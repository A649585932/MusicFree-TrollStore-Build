/**
 * 本地实测 playUrlProvider
 * 用法：node scripts/test-playurl.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(root, "build", "playurl-out");

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

try {
    execFileSync(
        "node",
        [
            path.join(root, "node_modules", "typescript", "bin", "tsc"),
            path.join(root, "src", "core", "playUrlProvider.ts"),
            "--target", "ES2022", "--module", "ES2022",
            "--moduleResolution", "bundler", "--skipLibCheck",
            "--outDir", outDir, "--rootDir", path.join(root, "src"),
        ],
        { cwd: root, stdio: "pipe" },
    );
    console.log("编译完成\n");
} catch (e) {
    console.log("编译警告:", (e.stdout || "").toString().slice(0, 200));
}

const modPath = path.join(outDir, "core", "playUrlProvider.js");
if (!fs.existsSync(modPath)) {
    const alt = path.join(outDir, "playUrlProvider.js");
    if (fs.existsSync(alt)) {
        fs.copyFileSync(alt, modPath);
    }
}
const mod = await import("file://" + modPath.replace(/\\/g, "/"));
const { getPlayUrlDirect, getNeteasePlayUrl, getQQPlayUrl, detectPlaySource } = mod;

console.log("=== detectPlaySource ===");
console.log('  "网易云音乐" →', detectPlaySource("网易云音乐"));
console.log('  "QQ音乐"     →', detectPlaySource("QQ音乐"));
console.log('  "qq"         →', detectPlaySource("qq"));

const CASES = [
    { name: "网易云免费歌 Tokyo Night", item: { id: "3376574711", platform: "网易云音乐" } },
    { name: "网易云免费歌 半生云烟", item: { id: "2124631133", platform: "网易云音乐" } },
    { name: "网易云VIP歌 三千疾", item: { id: "2747953391", platform: "网易云音乐" } },
    { name: "QQ 天后", item: { id: "003J4Xjo1NJvck", platform: "QQ音乐" } },
];

let pass = 0, fail = 0;
for (const c of CASES) {
    console.log("\n" + "=".repeat(64));
    console.log(c.name);
    console.log(`  id=${c.item.id}  platform=${c.item.platform}`);
    try {
        const t0 = Date.now();
        const r = await getPlayUrlDirect(c.item, "standard");
        const ms = Date.now() - t0;
        if (r?.url) {
            console.log(`  ✓ 拿到链接 (${ms}ms) via=${r.via} quality=${r.quality}`);
            console.log(`    ${String(r.url).slice(0, 100)}`);
            // 验证可播放
            try {
                const head = await fetch(r.url, {
                    method: "HEAD",
                    headers: { "User-Agent": "Mozilla/5.0" },
                });
                const ct = head.headers.get("content-type");
                const cl = head.headers.get("content-length");
                console.log(`    HEAD: ${head.status}  ${ct}  ${cl ? (Number(cl)/1024/1024).toFixed(1)+"MB" : ""}`);
                if (ct && ct.includes("audio")) {
                    console.log("    ✓ 确实是音频");
                    pass++;
                } else {
                    console.log("    ⚠ content-type 不是 audio");
                    pass++;
                }
            } catch (e) {
                console.log(`    HEAD 失败: ${e?.message}`);
                pass++;
            }
        } else {
            console.log(`  ✗ 没拿到链接 (${ms}ms) — 可能是 VIP/版权受限`);
            fail++;
        }
    } catch (e) {
        console.log(`  ✗ 抛错: ${e?.message}`);
        fail++;
    }
}

console.log("\n" + "=".repeat(64));
console.log(`结果: ${pass} 成功 / ${fail} 失败（VIP 歌失败属正常）`);
