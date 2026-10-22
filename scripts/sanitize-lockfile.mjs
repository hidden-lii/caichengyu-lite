#!/usr/bin/env node
// 去掉 package-lock.json 里指向非公共仓库（公司内网镜像等）的 "resolved" 地址。
//
// 为什么：本机 npm 走公司内网镜像时，锁文件里每个包的 resolved 都是内网地址。直接推到 GitHub 有两个问题：
// 1. 云端（GitHub Actions）访问不到内网地址，`npm ci` 会失败；
// 2. 内网域名会随仓库公开。
// 去掉 resolved 后 npm 按配置的仓库（云端用 --registry=https://registry.npmjs.org/）按「包名@版本」取包，
// 并用锁文件里的 integrity 校验，包内容不变。已经是 registry.npmjs.org 的地址原样保留。
//
// 用法：node scripts/sanitize-lockfile.mjs
// 首次提交前在本机跑一次；CI 里每次打包前也会跑（幂等：没有要改的就不写文件）。

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLIC_REGISTRY = "https://registry.npmjs.org/";
const file = join(dirname(fileURLToPath(import.meta.url)), "..", "package-lock.json");
const lock = JSON.parse(readFileSync(file, "utf8"));

let removed = 0;

/** lockfileVersion 2 的嵌套 `dependencies` 里也有 resolved，一并处理；v3 只有扁平的 `packages`。 */
function strip(entry) {
  if (entry === null || typeof entry !== "object") return;
  if (typeof entry.resolved === "string" && !entry.resolved.startsWith(PUBLIC_REGISTRY)) {
    delete entry.resolved;
    removed += 1;
  }
  if (entry.dependencies !== null && typeof entry.dependencies === "object") {
    for (const dep of Object.values(entry.dependencies)) strip(dep);
  }
}

for (const pkg of Object.values(lock.packages ?? {})) strip(pkg);
for (const dep of Object.values(lock.dependencies ?? {})) strip(dep);

if (removed === 0) {
  console.log("package-lock.json 里没有需要处理的 resolved 地址");
} else {
  writeFileSync(file, JSON.stringify(lock, null, 2) + "\n");
  console.log(`已去掉 package-lock.json 里 ${removed} 个非公共仓库的 resolved 地址`);
}
