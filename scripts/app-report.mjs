#!/usr/bin/env node
// 启动调试构建的真实 Tauri 应用，收取它经 Rust 输出的布局报告（CC_REPORT 行），写成 JSON 后退出应用。
//   node scripts/app-report.mjs --scene main --style m-cinnabar-light --out report.json [--timeout 40000]
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : null)).filter(Boolean),
);
if (!args.out) {
  console.error("需要 --out");
  process.exit(2);
}
const support = mkdtempSync(join(process.env.KIROCREW_SCRATCH || tmpdir(), "cc-support-"));
const child = spawn(join(root, "src-tauri/target/debug/caichengyu-lite"), [], {
  stdio: ["ignore", "ignore", "pipe"],
  env: {
    ...process.env,
    CAICHENGYU_SUPPORT_DIR: support,
    ...(args.scene ? { CAICHENGYU_SCENE: args.scene } : {}),
    ...(args.style ? { CAICHENGYU_STYLE: args.style } : {}),
  },
});
let buf = "";
const done = new Promise((resolveDone, reject) => {
  const timer = setTimeout(() => reject(new Error("等待 CC_REPORT 超时")), Number(args.timeout || 40000));
  child.stderr.on("data", (d) => {
    buf += d.toString();
    const m = buf.match(/CC_REPORT (\{.*\})\n/);
    if (m) {
      clearTimeout(timer);
      resolveDone(m[1]);
    }
  });
  child.on("exit", () => reject(new Error("应用提前退出")));
});
try {
  const json = await done;
  writeFileSync(args.out, json);
  const r = JSON.parse(json);
  console.log(JSON.stringify({ out: args.out, elements: r.rects.length, errors: r.errors, ua: r.userAgent, inner: r.inner, dpr: r.dpr }));
} finally {
  child.kill();
  setTimeout(() => rmSync(support, { recursive: true, force: true }), 500);
}
