// 筛选引擎测试的公共设施：小表构造、标记辅助、真实词库加载、字符串级参考实现、确定性随机数。
// 对应 Swift `DeduceEngineTestSupport.swift`。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LexiconBaker, LexiconMerger } from "../../../src/core/lexicon/catalog";
import { IdiomTable, IdiomTableBuilder, ReadingFlag } from "../../../src/core/lexicon/idiomTable";
import type { DeduceFilterResult } from "../../../src/core/engine/engine";
import {
  mergeDeduceConstraints,
  type DeduceMerged,
  type DeducePresent,
} from "../../../src/core/engine/constraints";
import {
  createGuess,
  createPositionMarks,
  type CharData,
  type DeduceGuess,
  type MarkState,
  type PolyphoneMap,
  type PositionMarks,
} from "../../../src/core/model/types";
import { buildChars } from "../../../src/core/pinyin/pinyin";
import { buildPolyphoneMap, readingsForChar } from "../../../src/core/pinyin/polyphone";
import { publicDir } from "./fsIO";

/** 用 `LexiconBaker` 烘出一张小词库。`pinyin` 可写数字调（"yi1 xin1 yi1 yi4"）。 */
export function deduceTestTable(items: readonly (readonly [string, string])[]): IdiomTable {
  const { builder } = LexiconBaker.bake(items.map(([word, pinyin]) => ({ word, pinyin, explanation: "" })));
  return IdiomTable.open(builder.serialize());
}

/** "hit" / "present" / "absent" → MarkState；其余（含 "null"）→ null */
export function deduceMarkState(s: string | null | undefined): MarkState | null {
  return s === "hit" || s === "present" || s === "absent" ? s : null;
}

/** 对应 Rust 测试里的 `mark(char, sm, ym, tone)`。 */
export function deduceMark(
  char: string | null,
  sm: string | null,
  ym: string | null,
  tone: string | null,
): PositionMarks {
  return createPositionMarks({
    char: deduceMarkState(char),
    sm: deduceMarkState(sm),
    ym: deduceMarkState(ym),
    tone: deduceMarkState(tone),
  });
}

/** 对应 Rust 测试里的 `mark_combo` / `mark_combo_tone`。 */
export function deduceMarkCombo(
  char: string,
  sm: string,
  ym: string,
  tone: string,
  opts: { combo: string; comboTone?: boolean },
): PositionMarks {
  return createPositionMarks({
    char: deduceMarkState(char),
    sm: deduceMarkState(sm),
    ym: deduceMarkState(ym),
    tone: deduceMarkState(tone),
    combo: deduceMarkState(opts.combo),
    comboTone: opts.comboTone ?? false,
  });
}

/** 对应 Rust 测试里的 `guess_all_hit`：全对，声韵调为字带出的自动标记。 */
export function deduceGuessAllHit(word: string, pinyin: string): DeduceGuess {
  const chars = buildChars(word, pinyin) as CharData[];
  const marks = chars.map(() =>
    createPositionMarks({ char: "hit", sm: "hit", ym: "hit", tone: "hit", autoSm: true, autoYm: true, autoTone: true }),
  );
  return createGuess({ word, pinyin, chars, marks });
}

export function deduceGuess(word: string, pinyin: string, marks: PositionMarks[]): DeduceGuess {
  return createGuess({ word, pinyin, chars: buildChars(word, pinyin) as CharData[], marks });
}

/** 由 (字, 数字拼音, 标记) 逐位拼出一条猜测。 */
export function deduceGuessFromSlots(slots: readonly (readonly [string, string, PositionMarks])[]): DeduceGuess {
  return deduceGuess(
    slots.map((s) => s[0]).join(""),
    slots.map((s) => s[1]).join(" "),
    slots.map((s) => s[2]),
  );
}

/** 从 JSON 文本构造多音表，如 `{"和":{"default":"he2","alts":["he4"]}}`。 */
export function deducePolyMap(json: string): PolyphoneMap {
  return buildPolyphoneMap(json);
}

export function deduceWords(r: DeduceFilterResult | null | undefined): string[] {
  return r?.items.map((i) => i.word) ?? [];
}

// MARK: - 真实词库

let realCache: { table: IdiomTable; poly: PolyphoneMap } | null = null;

/** `LexiconMerger.merge([merged.idx])` 的结果 + 真实多音表（读 public/lexicon）。 */
export function realLexicon(): { table: IdiomTable; poly: PolyphoneMap } {
  if (realCache) return realCache;
  const raw = readFileSync(join(publicDir, "lexicon/merged.idx"));
  const t = IdiomTable.open(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  const table = IdiomTable.open(LexiconMerger.merge([t]).builder.serialize());
  const poly = buildPolyphoneMap(readFileSync(join(publicDir, "lexicon/polyphones.json"), "utf-8"));
  realCache = { table, poly };
  return realCache;
}

// MARK: - 确定性随机数（mulberry32）

export class TestRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [lo, hi]（闭区间） */
  int(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo + 1));
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  bool(): boolean {
    return this.next() < 0.5;
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

/** 从真实词库随机抽 `count` 条四字词（保持原行序）建一张子表。 */
export function deduceSubTable(table: IdiomTable, count: number, rng: TestRNG): IdiomTable {
  const candidates: number[] = [];
  for (let i = 0; i < table.count; i++) {
    if (table.length(i) === 4 && table.flag(i) === ReadingFlag.valid) candidates.push(i);
  }
  rng.shuffle(candidates);
  const picked = candidates.slice(0, count).sort((a, b) => a - b);
  const builder = new IdiomTableBuilder();
  for (const i of picked) builder.append(table.word(i), table.chars(i), ReadingFlag.valid, "");
  return IdiomTable.open(builder.serialize());
}

// MARK: - 按真实答案生成猜测标记（Wordle 式对 / 偏 / 无，可注入噪声）

export const DeduceScenarioMaker = {
  /**
   * 对 `guessRow` 相对 `answerRow` 打标记：字 / 声 / 韵 / 调各自判 对 / 偏 / 无。
   * `noise` 为每个部件被随机改写的概率。
   */
  makeGuess(table: IdiomTable, guessRow: number, answerRow: number, noise: number, rng: TestRNG): DeduceGuess | null {
    const g = table.chars(guessRow);
    const a = table.chars(answerRow);
    if (g.length === 0 || g.length !== a.length) return null;
    const marks: PositionMarks[] = [];
    const state = (hit: boolean, elsewhere: boolean): MarkState => (hit ? "hit" : elsewhere ? "present" : "absent");
    const jitter = (s: MarkState): MarkState => {
      if (rng.next() >= noise) return s;
      return rng.pick<MarkState>(["hit", "present", "absent"]);
    };
    for (let i = 0; i < g.length; i++) {
      const m = createPositionMarks();
      m.char = jitter(state(g[i].c === a[i].c, a.some((x) => x.c === g[i].c)));
      m.sm = jitter(state(g[i].sm === a[i].sm, a.some((x) => x.sm === g[i].sm)));
      m.ym = jitter(state(g[i].ym === a[i].ym, a.some((x) => x.ym === g[i].ym)));
      m.tone = jitter(state(g[i].tone === a[i].tone, a.some((x) => x.tone === g[i].tone)));
      // 声韵组合偏：答案里别的字上确有同声同韵（含调时再同调）才标，且只在 sm/ym 都是「偏」时随机选用
      if (m.sm === "present" && m.ym === "present" && rng.next() < 0.5) {
        const comboElsewhere = a.some((x, j) => j !== i && x.sm === g[i].sm && x.ym === g[i].ym);
        if (comboElsewhere) {
          m.combo = "present";
          m.comboTone =
            a.some((x, j) => j !== i && x.sm === g[i].sm && x.ym === g[i].ym && x.tone === g[i].tone) && rng.bool();
        }
      }
      marks.push(m);
    }
    return createGuess({ word: table.word(guessRow), pinyin: table.pinyin(guessRow), chars: g, marks });
  },
};

// MARK: - 字符串级参考实现
//
// 逐行直译 Rust `deduce_filter_with` 的行匹配部分（字符串 / 数组，不做任何优化），
// 用来和整数编码的引擎做差分。约束合并复用被测模块的 `mergeDeduceConstraints`，
// 它的正确性由 Rust 用例翻译与 golden 夹具保证。

export interface ReferenceHit {
  row: number;
  word: string;
  chars: CharData[];
}

function viableReadings(
  ch: CharData,
  pos: number,
  m: DeduceMerged,
  locked: boolean,
  poly: PolyphoneMap | null,
): CharData[] {
  const f = pos < m.fixed.length ? m.fixed[pos] : null;
  return readingsForChar(ch, poly).filter((r) => {
    if (f) {
      if (f.sm !== undefined && r.sm !== f.sm) return false;
      if (f.ym !== undefined && r.ym !== f.ym) return false;
      if (f.tone !== undefined && r.tone !== f.tone) return false;
    }
    if (!locked) {
      if (r.sm.length > 0 && m.absentSm.has(r.sm)) return false;
      if (m.absentYm.has(r.ym)) return false;
      if (m.absentTone.has(r.tone)) return false;
      for (const e of m.excludeAt) {
        if (e.at !== pos) continue;
        switch (e.kind) {
          case "sm":
            if (e.valueStr.length > 0 && r.sm === e.valueStr) return false;
            break;
          case "ym":
            if (r.ym === e.valueStr) return false;
            break;
          case "tone":
            if (r.tone === e.valueTone) return false;
            break;
        }
      }
    }
    return true;
  });
}

function comboMatches(ch: CharData, sm: string, ym: string, tone: number): boolean {
  if (ch.sm !== sm || ch.ym !== ym) return false;
  return tone > 0 ? ch.tone === tone : true;
}

function attrMatches(ch: CharData, p: DeducePresent): boolean {
  switch (p.kind) {
    case "sm":
      return ch.sm === p.valueStr;
    case "ym":
      return ch.ym === p.valueStr;
    case "tone":
      return ch.tone === p.valueTone;
    case "combo":
      return comboMatches(ch, p.valueStr, p.valueYm, p.valueTone);
    case "char":
      return false;
  }
}

function satisfiesPresent(chosen: readonly CharData[], present: readonly DeducePresent[]): boolean {
  for (const p of present) {
    if (p.kind === "char") continue;
    if (p.notAt >= chosen.length) continue;
    if (attrMatches(chosen[p.notAt], p)) return false;
    const elsewhere = chosen.some((ch, j) => j !== p.notAt && attrMatches(ch, p));
    if (!elsewhere) return false;
  }
  return true;
}

function assign(viable: readonly CharData[][], present: readonly DeducePresent[]): CharData[] | null {
  const chosen: CharData[] = [];
  const dfs = (i: number): boolean => {
    if (i === viable.length) return satisfiesPresent(chosen, present);
    for (const r of viable[i]) {
      chosen.push(r);
      if (dfs(i + 1)) return true;
      chosen.pop();
    }
    return false;
  };
  return dfs(0) ? chosen : null;
}

function runOnce(table: IdiomTable, m: DeduceMerged, poly: PolyphoneMap | null): ReferenceHit[] {
  const out: ReferenceHit[] = [];
  for (let row = 0; row < table.count; row++) {
    if (table.flag(row) !== ReadingFlag.valid) continue;
    const chars = table.chars(row);
    const n = chars.length;
    if (m.len > 0 && n !== m.len) continue;
    const locked = chars.map((_, i) => i < m.fixed.length && m.fixed[i]?.c !== undefined && m.fixed[i] !== null);

    let ok = true;
    for (let i = 0; i < n; i++) {
      const c = i < m.fixed.length ? m.fixed[i]?.c : undefined;
      if (c !== undefined && chars[i].c !== c) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    for (const p of m.present) {
      if (p.kind !== "char" || p.notAt >= n) continue;
      const elsewhere = chars.some((ch, j) => j !== p.notAt && ch.c === p.valueStr);
      if (!elsewhere || chars[p.notAt].c === p.valueStr) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    for (const v of m.absentChar) {
      if (chars.some((ch) => ch.c === v)) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    const viable = chars.map((ch, i) => viableReadings(ch, i, m, locked[i], poly));
    if (viable.some((v) => v.length === 0)) continue;
    const assigned = assign(viable, m.present);
    if (assigned === null) continue;
    out.push({ row, word: table.word(row), chars: assigned });
  }
  return out;
}

export const DeduceReference = {
  /** 与 Rust `deduce_filter` 同义（guesses 非空）。 */
  filter(
    table: IdiomTable,
    guesses: readonly DeduceGuess[],
    polyMap: PolyphoneMap,
    includePolyphones: boolean,
  ): ReferenceHit[] {
    const m = mergeDeduceConstraints(guesses);
    if (includePolyphones && polyMap.size > 0) return runOnce(table, m, polyMap);
    const first = runOnce(table, m, null);
    if (first.length > 0 || polyMap.size === 0) return first;
    return runOnce(table, m, polyMap);
  },
};
