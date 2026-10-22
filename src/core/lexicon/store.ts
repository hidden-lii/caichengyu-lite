// 词库存储：所选内置来源 + 用户改动 → 一张可直接用的 `IdiomTable`。对应 Swift `Lexicon/LexiconStore.swift`。
//
// 用户数据（经 `DataIO`，相对数据目录）：
//   settings.json   所选来源 id 数组，顺序即优先级；缺省 = 默认全选
//   edits.json      用户改动（LexiconEdits），独立于所选来源，切换词库后继续生效；
//                   损坏时改名为 edits.corrupt.json 留档，按无改动处理
//
// 与 Swift 的差异：没有磁盘缓存。实测「默认全选 9 个源合并」在 Node 里只要百余毫秒
// （读取 + 校验 25ms，合并 80ms，序列化 30ms），远低于 1.5 秒的目标，所以省掉了 stage1 / final 两级缓存
// 与 cache/meta.json；每次启动都从随包 .idx 合并。合并结果（stage1）与「stage1 + 用户改动」（final）
// 都保存在内存里，变更词条时只重做 final，不重新合并。
//
// 并发：所有公开操作经一条 Promise 队列串行执行，任意并发调用不会交错（对应 Swift 的 actor）。

import { buildChars, normalizePinyinInput } from "../pinyin/pinyin";
import { buildPolyphoneMap } from "../pinyin/polyphone";
import { emptyPolyMap, type PolyphoneMap } from "../model/types";
import { trimUnicodeWhitespace } from "../text";
import { yieldToEventLoop } from "../engine/yield";
import { LexiconCatalog, LexiconEdits, LexiconMerger, type BuiltinLexicon } from "./catalog";
import type { DataIO } from "./dataIO";
import { IdiomTable } from "./idiomTable";
import {
  LexiconSnapshot,
  LexiconStoreError,
  createOutcome,
  type LexiconProgress,
  type LexiconStoreCounters,
  type LoadReport,
  type MutationResult,
  type UpsertOutcome,
} from "./types";

export interface LexiconStoreOptions {
  /** 数据 IO（用户数据读写 + 随包资源） */
  io: DataIO;
  /** 随包资源里存放 `<id>.idx` 的目录（相对 public/），默认 "lexicon" */
  bundleDir?: string;
  /** `polyphones.json` 的位置（随包资源路径），缺省取 `<bundleDir>/polyphones.json` */
  polyphonesPath?: string;
}

interface Resolved {
  final: IdiomTable;
  stage1: IdiomTable;
  skipped: number;
  built: string[];
}

const SETTINGS_NAME = "settings.json";
const EDITS_NAME = "edits.json";
const EDITS_CORRUPT_NAME = "edits.corrupt.json";

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 去重、丢弃未知 id，保持传入顺序。 */
function normalizeSelection(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of ids) {
    const id = trimUnicodeWhitespace(raw);
    if (LexiconCatalog.info(id) === undefined || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export class LexiconStore {
  private readonly io: DataIO;
  private readonly bundleDir: string;
  private readonly polyphonesPath: string;

  private initialized = false;
  private selected: string[] = [];
  private edits = new LexiconEdits();
  private polyMap: PolyphoneMap | null = null;
  private current: LexiconSnapshot | null = null;
  /** stage1 的表（无改动时与 final 同一个对象） */
  private stage1: IdiomTable | null = null;
  private generation = 0;
  private stats: LexiconStoreCounters = { merges: 0, sourceOpens: 0, cacheOpens: 0, cacheWrites: 0 };
  private chain: Promise<unknown> = Promise.resolve();

  constructor(options: LexiconStoreOptions) {
    this.io = options.io;
    this.bundleDir = (options.bundleDir ?? "lexicon").replace(/\/+$/, "");
    this.polyphonesPath = options.polyphonesPath ?? `${this.bundleDir}/polyphones.json`;
  }

  // MARK: - 串行化

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  // MARK: - 只读访问

  get catalog(): readonly BuiltinLexicon[] {
    return LexiconCatalog.all;
  }

  /** 当前所选来源 id（顺序即优先级）。 */
  selectedSources(): Promise<string[]> {
    return this.serial(async () => {
      await this.ensureInit();
      return this.selected.slice();
    });
  }

  /** 已加载的快照；未加载时为 null。 */
  currentSnapshot(): LexiconSnapshot | null {
    return this.current;
  }

  /** 累计计数（测试 / 诊断）。 */
  counters(): LexiconStoreCounters {
    return { ...this.stats };
  }

  // MARK: - 加载

  /** 加载词库。已经加载过的 store 再次调用，直接返回当前快照。 */
  load(progress?: LexiconProgress): Promise<{ snapshot: LexiconSnapshot; report: LoadReport }> {
    return this.serial(async () => {
      await this.ensureInit();
      if (this.current !== null) {
        return { snapshot: this.current, report: { fromCache: true, durationMs: 0, builtStages: [] } };
      }
      return await this.loadNow(progress);
    });
  }

  private async loadNow(progress?: LexiconProgress): Promise<{ snapshot: LexiconSnapshot; report: LoadReport }> {
    const started = now();
    progress?.("正在载入词库…");
    await yieldToEventLoop();
    const resolved = await this.resolve(this.selected, this.edits, progress);
    const snapshot = await this.commit(resolved, this.selected);
    return { snapshot, report: this.report(resolved.built, started) };
  }

  private async ensureLoaded(): Promise<LexiconSnapshot> {
    if (this.current !== null) return this.current;
    return (await this.loadNow()).snapshot;
  }

  // MARK: - 变更：切换来源

  /**
   * 切换所选内置词库（顺序即优先级）。未知 id 丢弃；一个都不剩则抛「请至少选择一个内置词库」。
   * 成功后保存 settings.json，并重做 stage1 + final。
   */
  applySources(ids: readonly string[], progress?: LexiconProgress): Promise<MutationResult> {
    return this.serial(async () => {
      await this.ensureInit();
      const normalized = normalizeSelection(ids);
      if (normalized.length === 0) throw LexiconStoreError.noSourceSelected();
      // 不要求旧来源能加载：当前所选来源损坏 / 缺失时，切换来源正是恢复手段
      const started = now();
      // 所选来源与已加载的完全相同：沿用内存里的合并结果，不重做任何阶段
      const reusable =
        this.current !== null &&
        this.stage1 !== null &&
        normalized.length === this.selected.length &&
        normalized.every((id, i) => id === this.selected[i]);
      const resolved: Resolved = reusable
        ? { final: this.current!.table, stage1: this.stage1!, skipped: this.current!.skipped, built: [] }
        : await this.resolve(normalized, this.edits, progress);
      await this.writeJSON(SETTINGS_NAME, JSON.stringify(normalized));
      this.selected = normalized;
      const snapshot = await this.commit(resolved, normalized);
      return {
        outcome: createOutcome({ added: snapshot.count, skipped: snapshot.skipped }),
        snapshot,
        report: this.report(resolved.built, started),
      };
    });
  }

  // MARK: - 变更：新增 / 修改 / 删除

  /** 新增成语；词已存在则更新读音与释义（语义同桌面 upsert）。 */
  addIdiom(word: string, pinyin: string, explanation = "", progress?: LexiconProgress): Promise<MutationResult> {
    return this.serial(async () => {
      await this.ensureInit();
      const snap = await this.ensureLoaded();
      const w = trimUnicodeWhitespace(word);
      const py = normalizePinyinInput(pinyin);
      if (w.length === 0 || py.length === 0) {
        return this.noChange(snap, createOutcome({ skipped: 1, errors: ["存在无效条目（缺少 word 或 pinyin）"] }));
      }
      if (buildChars(w, py) === null) {
        return this.noChange(snap, createOutcome({ skipped: 1, errors: [`「${w}」拼音音节数与字数不一致`] }));
      }
      const existed = snap.table.rowForWord(w) !== null;
      const newEdits = this.edits.clone();
      newEdits.set(w, py, trimUnicodeWhitespace(explanation));
      const outcome = existed ? createOutcome({ updated: 1 }) : createOutcome({ added: 1 });
      return await this.commitEdits(newEdits, outcome, progress, []);
    });
  }

  /** 只改已存在成语的读音（保留释义）。成功后 final 由 stage1 + 改动重做，不重新合并。 */
  updatePinyin(word: string, pinyin: string, progress?: LexiconProgress): Promise<MutationResult> {
    return this.serial(async () => {
      await this.ensureInit();
      const snap = await this.ensureLoaded();
      const w = trimUnicodeWhitespace(word);
      const py = normalizePinyinInput(pinyin);
      if (w.length === 0 || py.length === 0) {
        return this.noChange(snap, createOutcome({ skipped: 1, errors: ["成语或拼音不能为空"] }));
      }
      if (snap.table.rowForWord(w) === null) {
        return this.noChange(snap, createOutcome({ skipped: 1, errors: [`词库中不存在「${w}」`] }));
      }
      if (buildChars(w, py) === null) {
        return this.noChange(snap, createOutcome({ skipped: 1, errors: [`「${w}」拼音音节数与字数不一致`] }));
      }
      const newEdits = this.edits.clone();
      newEdits.set(w, py, null); // null = 保留释义
      return await this.commitEdits(newEdits, createOutcome({ updated: 1 }), progress, []);
    });
  }

  /** 删除成语。词不在当前词库中则不改动（`outcome.deleted == 0`）。 */
  deleteIdiom(word: string, progress?: LexiconProgress): Promise<MutationResult> {
    return this.serial(async () => {
      await this.ensureInit();
      const snap = await this.ensureLoaded();
      const w = trimUnicodeWhitespace(word);
      if (w.length === 0 || snap.table.rowForWord(w) === null) {
        return this.noChange(snap, createOutcome({ skipped: 1, errors: [`词库中不存在「${w}」`] }));
      }
      const built: string[] = [];
      const base = await this.ensureStage1(built, progress);
      const newEdits = this.edits.clone();
      if (base.rowForWord(w) !== null) {
        newEdits.delete(w); // 来自内置源：记一条删除，切换词库后依然隐藏
      } else {
        newEdits.items = newEdits.items.filter((e) => e.word !== w); // 纯用户新增的词：直接撤销那条新增
      }
      return await this.commitEdits(newEdits, createOutcome({ deleted: 1 }), progress, built);
    });
  }

  // MARK: - 解析 / 构建

  /** 得到 stage1（多源合并）与 final（再应用用户改动）。不改动任何实例状态（除计数外），由调用方 `commit`。 */
  private async resolve(ids: readonly string[], edits: LexiconEdits, progress?: LexiconProgress): Promise<Resolved> {
    const { table: stage1, skipped } = await this.buildStage1(ids, progress);
    const built = ["stage1"];
    let final = stage1;
    if (!edits.isEmpty) {
      progress?.("正在应用词库改动…");
      await yieldToEventLoop();
      final = IdiomTable.open(edits.apply(stage1).serialize());
      built.push("final");
    }
    return { final, stage1, skipped, built };
  }

  /** 把解析结果落为当前状态并生成新快照。 */
  private async commit(r: Resolved, sources: readonly string[]): Promise<LexiconSnapshot> {
    this.stage1 = r.stage1;
    this.generation += 1;
    const snapshot = new LexiconSnapshot(r.final, await this.loadPolyphones(), sources.slice(), r.skipped, this.generation);
    this.current = snapshot;
    return snapshot;
  }

  private async buildStage1(
    ids: readonly string[],
    progress?: LexiconProgress,
  ): Promise<{ table: IdiomTable; skipped: number }> {
    progress?.("正在读取词库…");
    await yieldToEventLoop();
    // 并行读取各来源；任何一个失败都抛 sourceUnavailable（带上出问题的来源 id）
    const tables = await Promise.all(
      ids.map(async (id) => {
        const info = LexiconCatalog.info(id);
        if (info === undefined) throw LexiconStoreError.sourceUnavailable(id, "未知的词库");
        try {
          const buf = await this.io.bundled(`${this.bundleDir}/${info.bakedFile}`);
          const table = IdiomTable.open(buf);
          this.stats.sourceOpens += 1;
          return table;
        } catch (e) {
          throw LexiconStoreError.sourceUnavailable(id, describeError(e));
        }
      }),
    );
    progress?.("正在合并词库…");
    await yieldToEventLoop();
    const merged = LexiconMerger.merge(tables);
    this.stats.merges += 1;
    return { table: IdiomTable.open(merged.builder.serialize()), skipped: merged.dropped };
  }

  /** 取得 stage1 表：内存里有就用；否则重新合并（并记入 `built`）。 */
  private async ensureStage1(built: string[], progress?: LexiconProgress): Promise<IdiomTable> {
    if (this.stage1 !== null) return this.stage1;
    const { table } = await this.buildStage1(this.selected, progress);
    built.push("stage1");
    this.stage1 = table;
    return table;
  }

  /** 用新的改动集重做 final 并提交。先建表、再存 edits.json，最后才改内存状态，失败时保持原状。 */
  private async commitEdits(
    newEdits: LexiconEdits,
    outcome: UpsertOutcome,
    progress: LexiconProgress | undefined,
    alreadyBuilt: string[],
  ): Promise<MutationResult> {
    const started = now();
    const built = alreadyBuilt.slice();
    const base = await this.ensureStage1(built, progress);
    let final = base;
    if (!newEdits.isEmpty) {
      progress?.("正在应用词库改动…");
      await yieldToEventLoop();
      final = IdiomTable.open(newEdits.apply(base).serialize());
      built.push("final");
    }
    await this.writeJSON(EDITS_NAME, newEdits.encode());
    this.edits = newEdits;
    this.generation += 1;
    const snapshot = new LexiconSnapshot(
      final,
      await this.loadPolyphones(),
      this.selected.slice(),
      this.current?.skipped ?? 0,
      this.generation,
    );
    this.current = snapshot;
    return { outcome, snapshot, report: this.report(built, started) };
  }

  private noChange(snap: LexiconSnapshot, outcome: UpsertOutcome): MutationResult {
    return { outcome, snapshot: snap, report: { fromCache: true, durationMs: 0, builtStages: [] } };
  }

  private report(built: readonly string[], started: number): LoadReport {
    return { fromCache: built.length === 0, durationMs: Math.round(now() - started), builtStages: built.slice() };
  }

  /** 多音字表：随包资源缺失 / 损坏时降级为空表，不让加载失败。 */
  private async loadPolyphones(): Promise<PolyphoneMap> {
    if (this.polyMap !== null) return this.polyMap;
    let map: PolyphoneMap;
    try {
      map = buildPolyphoneMap(await this.io.bundledText(this.polyphonesPath));
    } catch {
      map = emptyPolyMap;
    }
    this.polyMap = map;
    return map;
  }

  // MARK: - 持久化（settings / edits）

  private async ensureInit(): Promise<void> {
    if (this.initialized) return;
    this.selected = await this.readSelection();
    this.edits = await this.readEdits();
    this.initialized = true;
  }

  private async readSelection(): Promise<string[]> {
    let ids: string[] = [];
    try {
      const text = await this.io.readData(SETTINGS_NAME);
      if (text !== null) {
        const raw = JSON.parse(text) as unknown;
        if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) ids = normalizeSelection(raw as string[]);
      }
    } catch {
      ids = [];
    }
    return ids.length === 0 ? LexiconCatalog.defaultSelection : ids;
  }

  private async readEdits(): Promise<LexiconEdits> {
    let text: string | null = null;
    try {
      text = await this.io.readData(EDITS_NAME);
    } catch {
      return new LexiconEdits();
    }
    if (text === null) return new LexiconEdits();
    const edits = LexiconEdits.decode(text);
    if (edits !== null) return edits;
    // 损坏的 edits.json 不能让 App 起不来，也不要悄悄覆盖：改名留档后按无改动处理
    try {
      await this.io.removeData(EDITS_CORRUPT_NAME);
      await this.io.renameData(EDITS_NAME, EDITS_CORRUPT_NAME);
    } catch {
      /* 留档失败也不影响启动 */
    }
    return new LexiconEdits();
  }

  private async writeJSON(name: string, text: string): Promise<void> {
    try {
      await this.io.writeData(name, text);
    } catch (e) {
      throw LexiconStoreError.io(describeError(e));
    }
  }
}
