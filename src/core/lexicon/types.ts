// LexiconStore 对外的值类型与错误。对应 Swift `Lexicon/LexiconStoreTypes.swift`。

import type { PolyphoneMap } from "../model/types";
import type { IdiomTable } from "./idiomTable";

/** 进度回调：给出一句中文短句（如「正在合并词库…」）。 */
export type LexiconProgress = (message: string) => void;

/** 一次加载 / 变更之后的词库快照（不可变；换词库就是换一个新快照）。 */
export class LexiconSnapshot {
  readonly table: IdiomTable;
  readonly polyMap: PolyphoneMap;
  /** 当前所选内置来源 id，顺序即优先级（第 0 位最高） */
  readonly sources: readonly string[];
  /** 合并时因读音无效 / 为空而被丢弃的词数 */
  readonly skipped: number;
  /** 快照代数：首次加载为 1，每次成功变更 +1；未发生变更的操作不递增 */
  readonly generation: number;

  constructor(table: IdiomTable, polyMap: PolyphoneMap, sources: readonly string[], skipped: number, generation: number) {
    this.table = table;
    this.polyMap = polyMap;
    this.sources = sources;
    this.skipped = skipped;
    this.generation = generation;
  }

  get count(): number {
    return this.table.count;
  }
}

/**
 * 一次加载 / 变更的执行情况。
 *
 * 与 Swift 的差异：这个版本没有磁盘缓存（实测默认全选合并只要百余毫秒），所以 `fromCache`
 * 的含义是「没有做任何重建工作」（重复 `load()`、校验失败的变更、重复应用同一组来源时为 true）。
 */
export interface LoadReport {
  fromCache: boolean;
  durationMs: number;
  /** 本次实际重做的阶段，取值 "stage1"（多源合并）、"final"（应用用户改动） */
  builtStages: string[];
}

/** 变更结果，与桌面 `UpsertResult` 对齐（另加 `deleted`）。 */
export interface UpsertOutcome {
  added: number;
  updated: number;
  skipped: number;
  deleted: number;
  errors: string[];
}

export function createOutcome(init: Partial<UpsertOutcome> = {}): UpsertOutcome {
  return {
    added: init.added ?? 0,
    updated: init.updated ?? 0,
    skipped: init.skipped ?? 0,
    deleted: init.deleted ?? 0,
    errors: init.errors ?? [],
  };
}

/** 是否真的改动了词库 */
export function outcomeChanged(o: UpsertOutcome): boolean {
  return o.added > 0 || o.updated > 0 || o.deleted > 0;
}

/**
 * 变更操作的返回：结果 + 变更后的快照 + 执行情况。
 * 没有改动词库时（如校验失败），`snapshot` 仍是当前快照，`generation` 不变。
 */
export interface MutationResult {
  outcome: UpsertOutcome;
  snapshot: LexiconSnapshot;
  report: LoadReport;
}

/** 累计计数，供测试与诊断断言「有没有重新合并 / 打开源文件」。 */
export interface LexiconStoreCounters {
  /** `LexiconMerger.merge` 的调用次数 */
  merges: number;
  /** 打开源 .idx（内置词库）的次数 */
  sourceOpens: number;
  /** 恒为 0（没有磁盘缓存），保留字段以便与 Swift 对照 */
  cacheOpens: number;
  /** 恒为 0（没有磁盘缓存），保留字段以便与 Swift 对照 */
  cacheWrites: number;
}

export type LexiconStoreErrorKind = "noSourceSelected" | "sourceUnavailable" | "io";

export class LexiconStoreError extends Error {
  readonly kind: LexiconStoreErrorKind;
  readonly id: string | null;
  readonly reason: string | null;

  private constructor(kind: LexiconStoreErrorKind, message: string, id: string | null, reason: string | null) {
    super(message);
    this.name = "LexiconStoreError";
    this.kind = kind;
    this.id = id;
    this.reason = reason;
  }

  static noSourceSelected(): LexiconStoreError {
    return new LexiconStoreError("noSourceSelected", "请至少选择一个内置词库", null, null);
  }

  static sourceUnavailable(id: string, reason: string): LexiconStoreError {
    return new LexiconStoreError("sourceUnavailable", `内置词库「${id}」不可用：${reason}`, id, reason);
  }

  static io(message: string): LexiconStoreError {
    return new LexiconStoreError("io", `词库存储失败：${message}`, null, message);
  }
}
