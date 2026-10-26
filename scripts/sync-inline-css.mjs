// 把 src/client/style.css 内联同步进 lib/client.js 的 style_default 字符串。
// 用途：样式迭代时免跑完整构建（tsc 会覆盖 lib/index.js 的手工特性），改完 CSS
// 跑本脚本 + 重启应用即生效。
//
// 用法：node scripts/sync-inline-css.mjs
import fs from "node:fs";

const CSS_FILE = "src/client/style.css";
const LIB_FILE = "lib/client.js";
const START = "var style_default = '";

const css = fs.readFileSync(CSS_FILE, "utf8");
const esc = css
  .replace(/\\/g, "\\\\")
  .replace(/'/g, "\\'")
  .replace(/\r?\n/g, "\\n");

const s = fs.readFileSync(LIB_FILE, "utf8");
const start = s.indexOf(START);
if (start === -1) {
  console.error("lib/client.js 里没找到 style_default 字符串");
  process.exit(1);
}
const contentStart = start + START.length;
const end = s.indexOf("';", contentStart);
if (end === -1) {
  console.error("style_default 字符串结尾未找到");
  process.exit(1);
}

const before = s.slice(contentStart, end);
fs.writeFileSync(LIB_FILE, s.slice(0, contentStart) + esc + s.slice(end));
console.log(
  `已同步 src/client/style.css → lib/client.js（${before.length} → ${esc.length} 字符）。重启应用生效。`,
);
