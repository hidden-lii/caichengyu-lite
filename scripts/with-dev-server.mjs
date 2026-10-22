#!/usr/bin/env node
// 起一个临时的 Vite 开发服务，在它存活期间运行一条命令，命令结束后自动关闭服务。
// 全程在一个进程里完成，不留后台服务，也不需要手动结束任何进程。
//
// 用法：
//   node scripts/with-dev-server.mjs -- node scripts/shot.mjs shot --url "{URL}/?scene=main" --out out.png --wait-ready
//   命令参数里的 {URL} 会替换为服务地址（形如 http://127.0.0.1:1420，不带结尾斜杠）。
//   端口默认 1420，被占用时自动换下一个。

import { spawn } from "node:child_process";
import { createServer } from "vite";

const sep = process.argv.indexOf("--");
const command = sep === -1 ? [] : process.argv.slice(sep + 1);
if (command.length === 0) {
  console.error("用法：with-dev-server.mjs -- <命令> [参数…]（参数里的 {URL} 会被替换）");
  process.exit(2);
}

const server = await createServer({
  logLevel: "warn",
  server: { host: "127.0.0.1", port: 1420, strictPort: false },
});
await server.listen();
const url = (server.resolvedUrls?.local?.[0] ?? "http://127.0.0.1:1420/").replace(/\/$/, "");

const [bin, ...rest] = command.map((a) => a.replaceAll("{URL}", url));
const child = spawn(bin, rest, { stdio: "inherit", env: { ...process.env, DEV_URL: url } });

const finish = async (code) => {
  await server.close();
  process.exit(code);
};
child.on("error", (e) => {
  console.error(String(e));
  void finish(1);
});
child.on("exit", (code) => void finish(code ?? 1));
