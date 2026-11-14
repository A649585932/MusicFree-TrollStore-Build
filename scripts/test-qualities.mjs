/** 验证导入的 songs 带上了 qualities（对齐桌面版结构） */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "build", "qual-out");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
try {
    execFileSync("node", [
        path.join(root, "node_modules", "typescript", "bin", "tsc"),
        path.join(root, "src", "core", "sheetImporter.ts"),
        path.join(root, "src", "utils", "resolveShortLink.ts"),
        "--target", "ES2022", "--module", "ES2022", "--moduleResolution", "bundler",
        "--skipLibCheck", "--outDir", out, "--rootDir", path.join(root, "src"),
    ], { cwd: root, stdio: "pipe" });
} catch {}
const p = path.join(out, "core", "sheetImporter.js");
let t = fs.readFileSync(p, "utf8");
t = t.replace('from "../utils/resolveShortLink"', 'from "../utils/resolveShortLink.js"');
fs.writeFileSync(p, t, "utf8");
const { importSheetDirect } = await import("file://" + p.replace(/\\/g, "/"));

for (const [label, input] of [
    ["网易云", "https://music.163.com/playlist?id=365054063&uct2=U2FsdGVkX18/qgUgPDYWoorxhjMEkUNVdQlWGDECwAU="],
    ["QQ", "https://c6.y.qq.com/base/fcgi-bin/u?__=oEa1VXNj9ymM"],
]) {
    console.log(`\n=== ${label} ===`);
    try {
        const r = await importSheetDirect(input);
        console.log(`  歌单: 《${r.sheetName}》 ${r.songs.length} 首`);
        const withQ = r.songs.filter(s => s.qualities && Object.keys(s.qualities).length);
        console.log(`  带 qualities 的歌: ${withQ.length}/${r.songs.length}`);
        if (withQ.length) {
            const s = withQ[0];
            console.log(`  示例: ${s.title}`);
            console.log(`    id=${s.id}`);
            console.log(`    qualities=${JSON.stringify(s.qualities)}`);
        }
    } catch (e) { console.log("  ERR:", e?.message); }
}
