// 词库烘焙：把内置词库的源 JSON（idiom.json、idioms_*.json）烘焙为列式 .idx，运行时直接加载。
//
// 这一步原先由 mac 版的 Swift 工具 `bake-lexicon` 完成；现在用本项目自己的 TS 烘焙逻辑
// （src/core/lexicon/catalog.ts 的 `LexiconBaker`，运行时「新增 / 改读音」也走同一条路径）重新实现，
// 产物格式就是 `IdiomTable` 读写的 .idx，不再依赖 Swift 工具链。
//
// 入口是 `npm run bake`（scripts/bake-lexicon.mjs）：它负责把本文件即时打包成 Node 能直接运行的模块并调用 `bakeLexicons`。
// 本文件只依赖 node:fs / node:path 与 src/core，便于单独测试。

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LexiconBaker, LexiconCatalog, type BakeStats } from "../src/core/lexicon/catalog";
import { IdiomTable } from "../src/core/lexicon/idiomTable";

export interface BakeOptions {
  /** 含 idiom.json / idioms_*.json 的目录 */
  srcDir: string;
  /** .idx 输出目录（运行时从 public/lexicon 读取） */
  outDir: string;
  /** 只烘焙这些词库 id；省略 = 目录里的全部 9 个 */
  only?: readonly string[];
  /** 逐行进度输出；省略 = 不输出 */
  log?: (line: string) => void;
}

export interface BakeResult {
  id: string;
  stats: BakeStats;
  /** 产物字节数 */
  bytes: number;
  /** 烘焙 + 写盘 + 回读校验的耗时（毫秒） */
  ms: number;
}

/** 读源 JSON。去掉开头可能存在的 BOM（`JSON.parse` 不认）。 */
function readSource(path: string): string {
  const text = readFileSync(path, "utf-8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** 先写同目录下的临时文件再改名：写到一半出错不会留下半个 .idx，也不会把已有的好产物覆盖坏。 */
function writeAtomic(path: string, bytes: Uint8Array): void {
  const tmp = `${path}.tmp`;
  try {
    writeFileSync(tmp, bytes);
    renameSync(tmp, path);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + " ".repeat(width - text.length);
}

/**
 * 烘焙内置词库。任何一步失败都直接抛错（缺源文件、JSON 不是数组、产物回读不一致…），
 * 不会留下半成品：每个 .idx 都是原子写入的，且在开始前先检查源文件是否齐全。
 */
export function bakeLexicons(options: BakeOptions): BakeResult[] {
  const { srcDir, outDir } = options;
  const log = options.log ?? ((): void => undefined);

  const ids = options.only ?? LexiconCatalog.all.map((l) => l.id);
  const unknown = ids.filter((id) => LexiconCatalog.info(id) === undefined);
  if (unknown.length > 0) {
    const known = LexiconCatalog.all.map((l) => l.id).join("、");
    throw new Error(`未知的词库 id：${unknown.join("、")}（可用：${known}）`);
  }
  const wanted = new Set(ids);
  const lexicons = LexiconCatalog.all.filter((l) => wanted.has(l.id));

  const missing = lexicons.filter((l) => !existsSync(join(srcDir, l.sourceFile)));
  if (missing.length > 0) {
    throw new Error(`在 ${srcDir} 里找不到词库源文件：${missing.map((l) => l.sourceFile).join("、")}`);
  }

  mkdirSync(outDir, { recursive: true });
  const results: BakeResult[] = [];
  for (const lex of lexicons) {
    const started = performance.now();
    const { builder, stats } = LexiconBaker.bakeJSON(readSource(join(srcDir, lex.sourceFile)), lex.fourCharOnly);
    const bytes = builder.serialize();
    const target = join(outDir, lex.bakedFile);
    writeAtomic(target, bytes);

    // 回读校验：落盘的产物必须能被运行时加载（魔数 / 版本 / 长度 / 校验和），且条数与烘焙统计一致
    const table = IdiomTable.open(new Uint8Array(readFileSync(target)));
    if (table.count !== stats.total) {
      throw new Error(`${lex.id} 回读条数不符：${table.count} ≠ ${stats.total}`);
    }

    const ms = Math.round(performance.now() - started);
    results.push({ id: lex.id, stats, bytes: bytes.byteLength, ms });
    log(
      `${pad(lex.id, 13)} total=${stats.total} valid=${stats.valid} invalid=${stats.invalid} empty=${stats.empty} ` +
        `dropped4=${stats.droppedNotFourChar} → ${Math.round(bytes.byteLength / 1024)} KB  ${ms} ms`,
    );
  }
  return results;
}
