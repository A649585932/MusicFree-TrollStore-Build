/**
 * parseSheetLink 单元测试（纯函数，无需 RN 运行时）
 *
 * 跑法：node --experimental-strip-types scripts/test-parse-sheet.mjs
 * 或   npx tsx scripts/test-parse-sheet.mjs
 *
 * 这里用最朴素的断言，避免引入 jest 配置依赖。
 */
import {
    extractUrl,
    parseSheetShareLink,
    parseMultipleSheetLinks,
} from "../src/utils/parseSheetLink.ts";

let pass = 0;
let fail = 0;

function eq(name, actual, expected) {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (ok) {
        pass++;
        console.log(`  ok   ${name}`);
    } else {
        fail++;
        console.log(`  FAIL ${name}`);
        console.log(`       expected: ${JSON.stringify(expected)}`);
        console.log(`       actual  : ${JSON.stringify(actual)}`);
    }
}

function ok(name, cond) {
    if (cond) {
        pass++;
        console.log(`  ok   ${name}`);
    } else {
        fail++;
        console.log(`  FAIL ${name}`);
    }
}

console.log("\n=== extractUrl ===");
eq(
    "从分享文案抠链接",
    extractUrl("分享歌单《周杰伦》https://y.qq.com/n/ryqq/playlist/7823490513 快听"),
    "https://y.qq.com/n/ryqq/playlist/7823490513",
);
eq("纯链接", extractUrl("https://music.163.com/playlist?id=24381616"), "https://music.163.com/playlist?id=24381616");
eq("无链接返回 null", extractUrl("这是一段没有链接的文字"), null);

console.log("\n=== QQ 音乐 ===");
{
    const r = parseSheetShareLink("https://y.qq.com/n/ryqq/playlist/7823490513");
    eq("platform", r?.platform, "qq");
    eq("id", r?.id, "7823490513");
    eq("normalizedUrl", r?.normalizedUrl, "https://y.qq.com/n/ryqq/playlist/7823490513");
}
{
    const r = parseSheetShareLink(
        "https://i.y.qq.com/n2/m/share/details/taoge.html?id=987654321&ADTAG=share",
    );
    eq("taoge 形式 platform", r?.platform, "qq");
    eq("taoge 形式 id", r?.id, "987654321");
}
{
    // 短链无法离线还原 id，应保留原链交给插件
    const r = parseSheetShareLink("https://c6.y.qq.com/base/fcgi-bin/u?__=AbCdEfGh");
    eq("短链 platform", r?.platform, "qq");
    eq("短链 id", r?.id, null);
    eq("短链保留原链", r?.normalizedUrl, "https://c6.y.qq.com/base/fcgi-bin/u?__=AbCdEfGh");
}

console.log("\n=== 网易云音乐 ===");
{
    const r = parseSheetShareLink("https://music.163.com/playlist?id=24381616");
    eq("platform", r?.platform, "netease");
    eq("id", r?.id, "24381616");
    eq("normalizedUrl", r?.normalizedUrl, "https://music.163.com/playlist?id=24381616");
}
{
    const r = parseSheetShareLink(
        "https://y.music.163.com/m/playlist?id=88776655&userid=123",
    );
    eq("m 站 platform", r?.platform, "netease");
    eq("m 站 id", r?.id, "88776655");
}
{
    const r = parseSheetShareLink(
        "分享单曲 网易云音乐 https://163cn.tv/abcDEF 来自@网易云音乐",
    );
    eq("短链 platform", r?.platform, "netease");
    eq("短链 id", r?.id, null);
}

console.log("\n=== 多链接解析 ===");
{
    const many = parseMultipleSheetLinks(`
        分享1 https://y.qq.com/n/ryqq/playlist/111
        分享2 https://music.163.com/playlist?id=222
        重复 https://y.qq.com/n/ryqq/playlist/111
    `);
    eq("数量(去重后)", many.length, 2);
    eq("第1个", many[0]?.id, "111");
    eq("第2个", many[1]?.id, "222");
}
eq("空输入", parseMultipleSheetLinks(""), []);
eq("无链接输入", parseMultipleSheetLinks("hello world"), []);

console.log("\n=== 未知平台 ===");
{
    const r = parseSheetShareLink("https://music.apple.com/cn/playlist/pl.abc123");
    eq("platform", r?.platform, "unknown");
    eq("id", r?.id, null);
    ok("保留原链", r?.normalizedUrl?.includes("apple.com"));
}

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
