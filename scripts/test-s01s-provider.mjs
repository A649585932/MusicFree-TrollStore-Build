/** 本地编译并真实调用 playUrlProvider，验证 QQ 会员歌能拿到可播放链接 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "build", "s01s-out");
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
try {
    execFileSync("node", [
        path.join(root, "node_modules", "typescript", "bin", "tsc"),
        path.join(root, "src", "core", "playUrlProvider.ts"),
        "--target", "ES2022", "--module", "ES2022", "--moduleResolution", "bundler",
        "--skipLibCheck", "--outDir", out, "--rootDir", path.join(root, "src"),
    ], { cwd: root, stdio: "pipe" });
} catch (e) { console.log("tsc warn", (e.stdout || "").toString().slice(0, 200)); }

const candidates = [
    path.join(out, "core", "playUrlProvider.js"),
    path.join(out, "playUrlProvider.js"),
];
let modPath = candidates.find(p => fs.existsSync(p));
if (!modPath) { console.log("编译产物不存在"); process.exit(1); }
const mod = await import("file://" + modPath.replace(/\\/g, "/"));
const { getPlayUrlDirect, getQQPlayUrl } = mod;

const CASES = [
    { name: "反方向的钟（周杰伦·会员）", id: "0017K7gL4WYnw2", platform: "qq" },
    { name: "天后（你的歌单·会员）", id: "003J4Xjo1NJvck", platform: "qq" },
    { name: "Whatever It Takes（会员）", id: "00318kzZ38BaJ4", platform: "qq" },
    { name: "三千疾（网易云）", id: "2747953391", platform: "netease" },
];

let pass = 0;
for (const c of CASES) {
    console.log("\n" + "=".repeat(60));
    console.log(`${c.name}  id=${c.id}`);
    for (const q of ["standard", "320k", "flac"]) {
        try {
            const r = await getPlayUrlDirect({ id: c.id, platform: c.platform }, q);
            if (r?.url) {
                console.log(`  [${q}] via=${r.via}  ${String(r.url).slice(0, 90)}`);
                try {
                    const h = await fetch(r.url, { method: "HEAD", headers: { "User-Agent": "Mozilla/5.0" } });
                    console.log(`       HEAD ${h.status} ${h.headers.get("content-type")} ${((Number(h.headers.get("content-length")) || 0) / 1048576).toFixed(1)}MB`);
                    pass++;
                } catch (e) { console.log(`       HEAD 失败 ${e?.message}`); pass++; }
                break;
            } else {
                console.log(`  [${q}] 空`);
            }
        } catch (e) {
            console.log(`  [${q}] ERR ${e?.message}`);
        }
    }
}
console.log(`\n结果: ${pass}/${CASES.length} 首拿到可播放链接`);
