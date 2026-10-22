#!/usr/bin/env node
// 在真实的 Tauri 窗口（WKWebView）里截图：启动调试构建的 .app，布置场景，抓取窗口，然后退出它。
//
//   node scripts/app-shot.mjs --scene main --style m-cinnabar-light --out out.png [--wait 8000]
//
// 只能用 `tauri build --debug` 的产物（发布构建会忽略场景环境变量）。用户数据目录重定向到 scratch，不污染真实数据。
// 依赖 macOS 的屏幕录制权限（screencapture）；没有权限时抓到的会是空白或桌面。

import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1]] : null))
    .filter(Boolean),
);
if (!args.out) {
  console.error("需要 --out");
  process.exit(2);
}
const bin = join(root, "src-tauri/target/debug/caichengyu-lite");
const support = mkdtempSync(join(process.env.KIROCREW_SCRATCH || tmpdir(), "cc-support-"));
const child = spawn(bin, [], {
  stdio: "ignore",
  env: {
    ...process.env,
    CAICHENGYU_SUPPORT_DIR: support,
    ...(args.scene ? { CAICHENGYU_SCENE: args.scene } : {}),
    ...(args.style ? { CAICHENGYU_STYLE: args.style } : {}),
  },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  await sleep(Number(args.wait || 8000));
  const info = execFileSync("swift", [join(root, "scripts/windowid.swift"), "caichengyu"], { encoding: "utf8" }).trim();
  const win = JSON.parse(info);
  if (!win) throw new Error("找不到窗口（应用没有起来，或没有屏幕录制权限）");
  execFileSync("screencapture", ["-x", "-o", "-l", String(win.id), args.out]);
  console.log(JSON.stringify({ out: args.out, window: win }));
} finally {
  child.kill();
  setTimeout(() => rmSync(support, { recursive: true, force: true }), 500);
}
