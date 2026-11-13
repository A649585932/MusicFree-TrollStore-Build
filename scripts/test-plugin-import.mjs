/**
 * 在 Node 里真实执行 padao QQ / 网易云插件，验证 importMusicSheet 能否导入。
 *
 * 目的：不再靠"看代码猜"，而是实打实跑一遍，看插件返回什么 / 抛什么错。
 *
 * 用法：node scripts/test-plugin-import.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import https from "node:https";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const PLUGINS = {
    qq: path.join(root, "build", "qq-plugin.js"),
    netease: path.join(root, "build", "netease-plugin.js"),
};

// 用户实际用的链接
const CASES = [
    {
        name: "QQ 短链",
        plugin: "qq",
        url: "https://c6.y.qq.com/base/fcgi-bin/u?__=oEa1VXNj9ymM",
    },
    {
        name: "QQ 纯ID 9774303959",
        plugin: "qq",
        url: "9774303959",
    },
    {
        name: "QQ 长链",
        plugin: "qq",
        url: "https://y.qq.com/n/ryqq/playlist/9774303959",
    },
    {
        name: "网易云带 uct2",
        plugin: "netease",
        url: "https://music.163.com/playlist?id=365054063&uct2=U2FsdGVkX18/qgUgPDYWoorxhjMEkUNVdQlWGDECwAU=",
    },
    {
        name: "网易云纯 id",
        plugin: "netease",
        url: "365054063",
    },
];

/** 给插件提供最小可用环境：fetch/axios 用 node 的 fetch 包一层 */
function makeAxiosShim() {
    const shim = async (config) => {
        const url = typeof config === "string" ? config : config.url;
        const headers = (typeof config === "object" && config.headers) || {};
        const resp = await fetch(url, {
            headers: { "User-Agent": "Mozilla/5.0", ...headers },
        });
        const text = await resp.text();
        let data = text;
        try {
            data = JSON.parse(text);
        } catch {
            /* 非 json 就保留文本 */
        }
        return { data, status: resp.status, headers: Object.fromEntries(resp.headers) };
    };
    shim.get = shim;
    shim.post = shim;
    shim.create = () => shim;
    shim.defaults = { headers: {} };
    shim.interceptors = {
        request: { use: () => {} },
        response: { use: () => {} },
    };
    return shim;
}

function loadPlugin(file, axiosShim) {
    const code = fs.readFileSync(file, "utf8");
    const module = { exports: {} };
    const req = (name) => {
        if (name === "axios") return axiosShim;
        if (name === "crypto-js") return { MD5: () => ({ toString: () => "x" }) };
        if (name === "dayjs") return () => ({ format: () => "" });
        if (name === "cheerio") return { load: () => ({}) };
        // 其他依赖给个宽松桩
        return new Proxy(
            {},
            {
                get: () => () => ({}),
            },
        );
    };
    const fn = new Function(
        "module",
        "exports",
        "require",
        "global",
        "process",
        code,
    );
    fn(module, module.exports, req, globalThis, process);
    return module.exports;
}

async function main() {
    // 检查插件文件
    for (const [k, f] of Object.entries(PLUGINS)) {
        if (!fs.existsSync(f)) {
            console.error(`缺少插件文件 ${k}: ${f}`);
            console.error("请先运行下载脚本");
            process.exit(1);
        }
        console.log(`✓ ${k} 插件 ${(fs.statSync(f).size / 1024).toFixed(0)}KB`);
    }

    const axiosShim = makeAxiosShim();

    for (const c of CASES) {
        console.log(`\n${"=".repeat(60)}`);
        console.log(`用例: ${c.name}`);
        console.log(`链接: ${c.url}`);

        let plugin;
        try {
            plugin = loadPlugin(PLUGINS[c.plugin], axiosShim);
        } catch (e) {
            console.log(`  ✗ 插件加载失败: ${e.message}`);
            continue;
        }

        const inst =
            typeof plugin === "function" ? plugin() : plugin;
        const def = inst?.default ?? inst;

        console.log(`  插件平台: ${def?.platform ?? "?"}`);
        console.log(`  有 importMusicSheet: ${typeof def?.importMusicSheet}`);

        if (typeof def?.importMusicSheet !== "function") {
            console.log("  ✗ 插件没有 importMusicSheet 方法");
            continue;
        }

        try {
            const t0 = Date.now();
            const result = await def.importMusicSheet(c.url);
            const ms = Date.now() - t0;
            console.log(`  ✓ 返回 ${Array.isArray(result) ? result.length : "null"} 首 (${ms}ms)`);
            if (Array.isArray(result) && result.length) {
                const s = result[0];
                console.log(`    样例: ${s.title} - ${s.artist}`);
            }
        } catch (e) {
            console.log(`  ✗ 抛错: ${e?.message ?? e}`);
            if (e?.stack) {
                console.log(`    ${String(e.stack).split("\n").slice(1, 4).join("\n    ")}`);
            }
        }
    }
}

main().catch((e) => {
    console.error("FATAL", e);
    process.exit(1);
});
