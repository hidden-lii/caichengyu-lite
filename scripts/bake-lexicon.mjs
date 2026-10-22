#!/usr/bin/env node
// 把 9 个内置词库的源 JSON 烘焙为列式 .idx（运行时直接加载）。原先由 mac 版 Swift 工具完成，现在在本项目里自己做。
//
// 用法：
//   npm run bake                                   # lexicon-src/ → public/lexicon/
//   npm run bake -- --src <目录> --out <目录>        # 指定源 / 输出目录
//   npm run bake -- --only xinhua,zdic             # 只烘焙其中几个（id 见 src/core/lexicon/catalog.ts）
//
// 源目录要含 idiom.json 和 idioms_{hwxnet,hanyuguoxue,baidu,zdic,chinesewords,moe,toollu,merged}.json
// （默认放在项目根的 lexicon-src/）。产物是 public/lexicon/<id>.idx，随前端一起打包。
// polyphones.json 不参与烘焙，直接放在 public/lexicon/ 里。
//
// 实现在 scripts/bake-lexicon.ts。烘焙用的是 src/core 里的同一套 TS 代码（TS 源码，不能被 Node 直接 import），
// 所以这里先用 Vite 把它即时打包成一个 ESM 模块，再加载运行；不新增任何依赖。

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `用法：npm run bake -- [--src <目录>] [--out <目录>] [--only <id,id,…>]
  --src   含 idiom.json / idioms_*.json 的目录（默认 lexicon-src）
  --out   .idx 输出目录（默认 public/lexicon）
  --only  只烘焙指定的词库 id，逗号分隔（默认全部）`;

function fail(message) {
  console.error(`错误：${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { src: join(root, "lexicon-src"), out: join(root, "public/lexicon"), only: undefined };
  const args = argv.slice();
  while (args.length > 0) {
    const a = args.shift();
    if (a === "--help" || a === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
    if (a === "--src" || a === "--out" || a === "--only") {
      const value = args.shift();
      if (value === undefined || value.startsWith("--")) fail(`${a} 需要一个值\n${USAGE}`);
      if (a === "--src") opts.src = resolve(process.cwd(), value);
      else if (a === "--out") opts.out = resolve(process.cwd(), value);
      else opts.only = value.split(",").map((s) => s.trim()).filter(Boolean);
    } else {
      fail(`未知参数 ${a}\n${USAGE}`);
    }
  }
  return opts;
}

/** 把 scripts/bake-lexicon.ts（连同它引用的 src/core 模块）打成一个 ESM 文件并 import。 */
async function loadBaker() {
  const result = await build({
    root,
    configFile: false, // 不要加载 vite.config.ts（里面有 Vue 插件和开发服务器配置）
    publicDir: false,
    logLevel: "warn",
    build: {
      ssr: join(root, "scripts/bake-lexicon.ts"),
      write: false, // 只要内存里的产物，不碰 dist/
      minify: false,
      target: "esnext",
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((r) => ("output" in r ? r.output : []));
  const chunks = outputs.filter((o) => o.type === "chunk");
  const entry = chunks.find((c) => c.isEntry);
  if (!entry || chunks.length !== 1) fail("打包烘焙工具失败：预期得到唯一一个入口模块");

  // 临时文件放在项目的 node_modules/.cache 下（而不是系统临时目录），这样打包产物里若有外部依赖也能按项目解析
  const dir = join(root, "node_modules", ".cache", "caichengyu-bake");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `bake-lexicon.${process.pid}.mjs`);
  writeFileSync(file, entry.code);
  try {
    return await import(pathToFileURL(file).href);
  } finally {
    rmSync(file, { force: true });
  }
}

const opts = parseArgs(process.argv.slice(2));
if (!existsSync(opts.src)) {
  fail(
    `找不到词库源目录 ${opts.src}\n` +
      `把源 JSON 放到项目根的 lexicon-src/（例如：cp -R ../caichengyu_mac/Resources/lexicon-src ./lexicon-src），或用 --src 指定目录。`,
  );
}
console.log(`==> 烘焙词库  ${opts.src}  →  ${opts.out}`);
const { bakeLexicons } = await loadBaker();
try {
  const started = Date.now();
  const results = bakeLexicons({ srcDir: opts.src, outDir: opts.out, only: opts.only, log: (line) => console.log(line) });
  const total = results.reduce((sum, r) => sum + r.bytes, 0);
  console.log(`==> 完成：${results.length} 个 .idx，共 ${Math.round(total / 1024)} KB，用时 ${Date.now() - started} ms`);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
