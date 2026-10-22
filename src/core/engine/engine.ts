// 「猜成语」筛选引擎。对应 Swift `Engine/DeduceEngine.swift` + `DeduceTypes.swift`。
// 权威实现：桌面 src-tauri/src/deduce.rs（TS 版 src/engine/deduce.ts 逻辑一致，二者有差异时以 Rust 为准）。
//
// 与 Rust 的有意差异：
//   · 数据层把 ü 一律规范成 v（Rust 对带调的 ǖǘǚǜ 用 ü、不带调的用 v）。
//   · guesses 为空时 `filter` 返回全表（对应 TS；Rust 返回空）。`matchingWords` 仍与 Rust 一致返回空数组。
//   · 越界容错：猜测字数不一致导致 notAt 超出候选词长度时，忽略该约束（Rust/TS 会越界崩溃）。
//
// 与 Swift 的差异：没有多线程并行（JS 单线程；6.7 万行单次扫描只要几毫秒）。取而代之的是
// 「分块 + 让出事件循环」的异步版本（`filterAsync` / `matchingWordsAsync`），保证大词库或慢设备上
// 一次筛选不会长时间占住界面线程；同步版本供测试与小表使用。

import type { CharData, DeduceGuess, PolyphoneMap, PositionMarks } from "../model/types";
import { cloneGuess, createPositionMarks } from "../model/types";
import { IdiomTable, ReadingFlag } from "../lexicon/idiomTable";
import { charsToMarkedPinyin } from "../pinyin/pinyin";
import {
  isAutoPronunciationAttr,
  pronunciationAttrs,
  setAutoPronunciationAttr,
} from "../pinyin/polyphone";
import { mergeDeduceConstraints } from "./constraints";
import { DeducePlan } from "./plan";
import { nowMs, yieldToEventLoop } from "./yield";

/** 一个命中的候选成语。 */
export interface DeduceCandidate {
  /** 词库表中的行号 */
  row: number;
  word: string;
  /** 按约束解析后的各位读音（多音字展开时可能与词库默认读音不同） */
  chars: CharData[];
  /** `charsToMarkedPinyin(chars)` */
  pinyin: string;
}

export interface DeduceFilterResult {
  /** 按词库行序排列的前 `limit` 条 */
  items: DeduceCandidate[];
  /** 全部匹配数 */
  total: number;
}

export interface DeduceFilterOptions {
  table: IdiomTable;
  guesses: readonly DeduceGuess[];
  polyMap: PolyphoneMap;
  /** 默认 200 */
  limit?: number;
  /** `true` 时始终展开多音字表；否则先按词库读音，完全无候选时再保底展开 */
  includePolyphones?: boolean;
  /** 返回 true 时尽快返回 null（每 256 行检查一次） */
  isCancelled?: () => boolean;
  /** 仅异步版本：每个时间片的毫秒数（默认 8）；超过就让出事件循环 */
  sliceMs?: number;
}

export interface DeduceScanResult {
  total: number;
  /** 按行序排的前 `keep` 个匹配行 */
  rows: number[];
}

/** 每个工作块的行数检查间隔（取消检查 / 时间片检查粒度）。 */
const CANCEL_CHECK_ROWS = 256;
const DEFAULT_SLICE_MS = 8;

const never = (): boolean => false;

// MARK: - 扫描

/** 扫描整张表，返回匹配总数与前 `keep` 个匹配行。被取消时返回 null。 */
function scan(plan: DeducePlan, keep: number, isCancelled: () => boolean): DeduceScanResult | null {
  const count = plan.table.count;
  if (plan.impossible || count === 0) return { total: 0, rows: [] };
  const sc = plan.makeScratch();
  let total = 0;
  const rows: number[] = [];
  let row = 0;
  while (row < count) {
    if (isCancelled()) return null;
    const blockEnd = Math.min(count, row + CANCEL_CHECK_ROWS);
    while (row < blockEnd) {
      if (plan.match(row, sc)) {
        total += 1;
        if (rows.length < keep) rows.push(row);
      }
      row += 1;
    }
  }
  return { total, rows };
}

/** 同 `scan`，但每个时间片（默认 8ms）让出一次事件循环。 */
async function scanAsync(
  plan: DeducePlan,
  keep: number,
  isCancelled: () => boolean,
  sliceMs: number,
): Promise<DeduceScanResult | null> {
  const count = plan.table.count;
  if (plan.impossible || count === 0) return { total: 0, rows: [] };
  const sc = plan.makeScratch();
  let total = 0;
  const rows: number[] = [];
  let row = 0;
  let sliceStart = nowMs();
  while (row < count) {
    if (isCancelled()) return null;
    const blockEnd = Math.min(count, row + CANCEL_CHECK_ROWS);
    while (row < blockEnd) {
      if (plan.match(row, sc)) {
        total += 1;
        if (rows.length < keep) rows.push(row);
      }
      row += 1;
    }
    if (row < count && nowMs() - sliceStart >= sliceMs) {
      await yieldToEventLoop();
      sliceStart = nowMs();
    }
  }
  return { total, rows };
}

/** 对前 `limit` 个匹配行重新匹配一次，取出解析后的读音。 */
function candidates(plan: DeducePlan, rows: readonly number[]): DeduceCandidate[] {
  if (rows.length === 0) return [];
  const table = plan.table;
  const sc = plan.makeScratch();
  const out: DeduceCandidate[] = [];
  for (const row of rows) {
    if (!plan.match(row, sc)) continue; // 与扫描阶段同一判定，不会发生
    const chars = plan.resolvedChars(row, sc);
    out.push({ row, word: table.word(row), chars, pinyin: charsToMarkedPinyin(chars) });
  }
  return out;
}

/** 无猜测：全表（读音有效的行），用词库默认读音。 */
function allRows(table: IdiomTable, limit: number, isCancelled: () => boolean): DeduceFilterResult | null {
  let total = 0;
  const items: DeduceCandidate[] = [];
  const cap = Math.max(limit, 0);
  for (let row = 0; row < table.count; row++) {
    if (row % CANCEL_CHECK_ROWS === 0 && isCancelled()) return null;
    if (table.flag(row) === ReadingFlag.valid) {
      total += 1;
      if (items.length < cap) {
        const chars = table.chars(row);
        items.push({ row, word: table.word(row), chars, pinyin: charsToMarkedPinyin(chars) });
      }
    }
  }
  return { items, total };
}

// MARK: - 对外接口

/**
 * 筛选成语候选，与 Rust `deduce_filter` 同义。
 *
 * - `items` 只含按词库行序排的前 `limit` 条，`total` 为全部匹配数。
 * - `includePolyphones == true` 时始终展开多音字表；否则先按词库读音，完全无候选时再保底展开。
 * - `guesses` 为空时返回全表（`total` = 读音有效的行数；`items` 用词库默认读音）。
 */
function filter(opts: DeduceFilterOptions): DeduceFilterResult | null {
  const { table, guesses, polyMap } = opts;
  const limit = opts.limit ?? 200;
  const includePolyphones = opts.includePolyphones ?? false;
  const isCancelled = opts.isCancelled ?? never;
  if (isCancelled()) return null;
  if (guesses.length === 0) return allRows(table, limit, isCancelled);

  const merged = mergeDeduceConstraints(guesses);
  const run = (usePoly: boolean): DeduceFilterResult | null => {
    const plan = new DeducePlan(table, merged, polyMap, usePoly);
    const result = scan(plan, Math.max(limit, 0), isCancelled);
    if (result === null) return null;
    return { items: candidates(plan, result.rows), total: result.total };
  };

  if (includePolyphones && polyMap.size > 0) return run(true);
  const first = run(false);
  if (first === null) return null;
  if (first.total > 0 || polyMap.size === 0) return first;
  return run(true);
}

/** 同 `filter`，分块并让出事件循环，可随时取消。 */
async function filterAsync(opts: DeduceFilterOptions): Promise<DeduceFilterResult | null> {
  const { table, guesses, polyMap } = opts;
  const limit = opts.limit ?? 200;
  const includePolyphones = opts.includePolyphones ?? false;
  const isCancelled = opts.isCancelled ?? never;
  const sliceMs = opts.sliceMs ?? DEFAULT_SLICE_MS;
  if (isCancelled()) return null;
  if (guesses.length === 0) return allRows(table, limit, isCancelled);

  const merged = mergeDeduceConstraints(guesses);
  const run = async (usePoly: boolean): Promise<DeduceFilterResult | null> => {
    const plan = new DeducePlan(table, merged, polyMap, usePoly);
    const result = await scanAsync(plan, Math.max(limit, 0), isCancelled, sliceMs);
    if (result === null) return null;
    return { items: candidates(plan, result.rows), total: result.total };
  };

  if (includePolyphones && polyMap.size > 0) return await run(true);
  const first = await run(false);
  if (first === null) return null;
  if (first.total > 0 || polyMap.size === 0) return first;
  return await run(true);
}

export interface DeduceMatchingOptions {
  table: IdiomTable;
  guesses: readonly DeduceGuess[];
  polyMap: PolyphoneMap;
  includePolyphones?: boolean;
  isCancelled?: () => boolean;
  sliceMs?: number;
}

/** 全部匹配词面（词库行序），与 Rust `deduce_matching_words` 同义。guesses 为空时返回空数组。 */
function matchingWords(opts: DeduceMatchingOptions): string[] | null {
  const { table, guesses, polyMap } = opts;
  const includePolyphones = opts.includePolyphones ?? false;
  const isCancelled = opts.isCancelled ?? never;
  if (isCancelled()) return null;
  if (guesses.length === 0) return [];

  const merged = mergeDeduceConstraints(guesses);
  const run = (usePoly: boolean): { total: number; words: string[] } | null => {
    const plan = new DeducePlan(table, merged, polyMap, usePoly);
    const result = scan(plan, Infinity, isCancelled);
    if (result === null) return null;
    return { total: result.total, words: result.rows.map((r) => table.word(r)) };
  };

  if (includePolyphones && polyMap.size > 0) return run(true)?.words ?? null;
  const first = run(false);
  if (first === null) return null;
  if (first.total > 0 || polyMap.size === 0) return first.words;
  return run(true)?.words ?? null;
}

/** 同 `matchingWords`，分块并让出事件循环，可随时取消。 */
async function matchingWordsAsync(opts: DeduceMatchingOptions): Promise<string[] | null> {
  const { table, guesses, polyMap } = opts;
  const includePolyphones = opts.includePolyphones ?? false;
  const isCancelled = opts.isCancelled ?? never;
  const sliceMs = opts.sliceMs ?? DEFAULT_SLICE_MS;
  if (isCancelled()) return null;
  if (guesses.length === 0) return [];

  const merged = mergeDeduceConstraints(guesses);
  const run = async (usePoly: boolean): Promise<{ total: number; words: string[] } | null> => {
    const plan = new DeducePlan(table, merged, polyMap, usePoly);
    const result = await scanAsync(plan, Infinity, isCancelled, sliceMs);
    if (result === null) return null;
    return { total: result.total, words: result.rows.map((r) => table.word(r)) };
  };

  if (includePolyphones && polyMap.size > 0) return (await run(true))?.words ?? null;
  const first = await run(false);
  if (first === null) return null;
  if (first.total > 0 || polyMap.size === 0) return first.words;
  return (await run(true))?.words ?? null;
}

// MARK: - 标记辅助（对应 TS 的 createEmptyMarks / finalizeMarks / guessHasMark / getActiveDeduceGuesses）

/** 一条新猜测的空标记。 */
function createEmptyMarks(len: number): PositionMarks[] {
  const out: PositionMarks[] = [];
  for (let i = 0; i < Math.max(len, 0); i++) out.push(createPositionMarks());
  return out;
}

/** 草稿参与筛选前定稿：未选的部件按「无」；字为对/偏时，未人选（或原本是自动带出）的声韵调跟随字并标记为自动。 */
function finalizeMarks(marks: readonly PositionMarks[]): PositionMarks[] {
  return marks.map((m) => {
    const out = createPositionMarks({
      char: m.char ?? "absent",
      sm: m.sm ?? "absent",
      ym: m.ym ?? "absent",
      tone: m.tone ?? "absent",
      combo: m.combo ?? "absent",
      comboTone: m.combo === "present" && m.comboTone,
    });
    if (out.char === "hit" || out.char === "present") {
      for (const attr of pronunciationAttrs) {
        const wasAuto = isAutoPronunciationAttr(m, attr);
        const wasUnset = m[attr] === null;
        if (wasAuto || wasUnset) {
          out[attr] = out.char;
          setAutoPronunciationAttr(out, attr, true);
        }
      }
    }
    return out;
  });
}

/** 是否至少有一个部件被标记过。 */
function guessHasMark(g: DeduceGuess | null | undefined): boolean {
  if (!g) return false;
  return g.marks.some((m) => m.char !== null || m.sm !== null || m.ym !== null || m.tone !== null || m.combo !== null);
}

/**
 * 已记录的猜测 + 有标记的草稿（定稿后）。草稿按 `editIndex` 替换；无 `editIndex` 时同词面替换，否则追加。
 * 返回的新数组里，未被替换的元素与 `recorded` 共用同一个对象（不复制）。
 */
function activeGuesses(recorded: readonly DeduceGuess[], draft: DeduceGuess | null | undefined): DeduceGuess[] {
  const list = recorded.slice();
  if (!draft || !guessHasMark(draft)) return list;
  const forFilter = cloneGuess(draft);
  forFilter.marks = finalizeMarks(draft.marks);
  const idx = draft.editIndex;
  if (idx !== null && idx >= 0 && idx < list.length) {
    list[idx] = forFilter;
    return list;
  }
  const existing = list.findIndex((g) => g.word === draft.word);
  if (existing >= 0) list[existing] = forFilter;
  else list.push(forFilter);
  return list;
}

export const DeduceEngine = {
  filter,
  filterAsync,
  matchingWords,
  matchingWordsAsync,
  scan,
  scanAsync,
  createEmptyMarks,
  finalizeMarks,
  guessHasMark,
  activeGuesses,
};
