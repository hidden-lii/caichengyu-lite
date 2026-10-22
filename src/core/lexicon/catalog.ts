// 内置词库目录、烘焙、多源合并、用户改动。对应 Swift `Lexicon/LexiconCatalog.swift`。
// 语义对照桌面 src-tauri/src/main.rs（builtin_lexicons）与 sqlite.rs（apply_lexicons_from_files / merge_lexicon_items）。

import type { IdiomInput } from "../model/types";
import { buildChars, normalizePinyinInput } from "../pinyin/pinyin";
import { codePointCount, scalarsToString, trimUnicodeWhitespace } from "../text";
import { fnvBytesAsScalars, hashOut, hex64 } from "./hash";
import { IdiomTable, IdiomTableBuilder, ReadingFlag } from "./idiomTable";

export interface BuiltinLexicon {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** 全选预设时的默认排序，数值越小优先级越高 */
  readonly defaultPriority: number;
  /** 爬虫源只保留四字成语；新华与混合词库保留更长的条目 */
  readonly fourCharOnly: boolean;
  /** 源 JSON 文件名（仅烘焙时用） */
  readonly sourceFile: string;
  /** 烘焙产物文件名 */
  readonly bakedFile: string;
}

function lex(
  id: string,
  name: string,
  description: string,
  defaultPriority: number,
  fourCharOnly: boolean,
  sourceFile: string,
): BuiltinLexicon {
  return { id, name, description, defaultPriority, fourCharOnly, sourceFile, bakedFile: `${id}.idx` };
}

export const LexiconCatalog = {
  all: [
    lex("xinhua", "新华成语", "内置新华成语词库（默认）", 6, false, "idiom.json"),
    lex("hwxnet", "汉文学网成语", "汉文学网成语，仅含四字", 3, true, "idioms_hwxnet.json"),
    lex("hanyuguoxue", "汉语国学成语", "汉语国学成语，仅含四字；拼音以此源为准", 1, true, "idioms_hanyuguoxue.json"),
    lex("baidu", "百度汉语成语", "百度汉语成语，仅含四字", 4, true, "idioms_baidu.json"),
    lex("zdic", "汉典成语", "汉典成语，仅含四字", 2, true, "idioms_zdic.json"),
    lex("chinesewords", "汉语网成语", "汉语网成语，仅含四字", 5, true, "idioms_chinesewords.json"),
    lex("moe", "教育部成語典", "台湾教育部《成語典》（繁体为主），仅含四字", 8, true, "idioms_moe.json"),
    lex("toollu", "tool.lu成语", "tool.lu 成语词典，仅含四字", 7, true, "idioms_toollu.json"),
    lex(
      "merged",
      "混合词库（全源合并）",
      "新华+汉文学网+汉语国学+百度+汉典+汉语网+教育部+tool.lu并集；原始拼音以汉语国学为准",
      9,
      false,
      "idioms_merged.json",
    ),
  ] as readonly BuiltinLexicon[],

  info(id: string): BuiltinLexicon | undefined {
    return LexiconCatalog.all.find((l) => l.id === id);
  },

  /** 去重并按默认优先级升序（第 0 位最高）。未知 id 丢弃。 */
  sortedByDefaultPriority(ids: readonly string[]): string[] {
    const seen = new Set<string>();
    return ids
      .filter((id) => {
        if (seen.has(id)) return false;
        seen.add(id);
        return LexiconCatalog.info(id) !== undefined;
      })
      .sort((a, b) => (LexiconCatalog.info(a)?.defaultPriority ?? 99) - (LexiconCatalog.info(b)?.defaultPriority ?? 99));
  },

  /** 全选预设：与桌面「默认全选优先级」一致。 */
  get defaultSelection(): string[] {
    return LexiconCatalog.sortedByDefaultPriority(LexiconCatalog.all.map((l) => l.id));
  },
};

// MARK: - 烘焙
// 离线烘焙（9 个源 JSON → public/lexicon/*.idx）：`npm run bake`，实现见 scripts/bake-lexicon.ts，用的就是下面的 `LexiconBaker`。

export interface BakeStats {
  total: number;
  valid: number;
  invalid: number;
  empty: number;
  droppedNotFourChar: number;
}

export const LexiconBaker = {
  /** 与桌面 `load_lexicon_json_file` 的 filter_map 一致：缺 word 或 pinyin 的条目丢弃。 */
  bakeJSON(jsonText: string, fourCharOnly: boolean): { builder: IdiomTableBuilder; stats: BakeStats } {
    const raw = JSON.parse(jsonText) as unknown;
    if (!Array.isArray(raw)) throw new Error("词库 JSON 不是数组");
    const items: IdiomInput[] = [];
    for (const r of raw) {
      const o = (r ?? {}) as Record<string, unknown>;
      if (typeof o.word !== "string" || typeof o.pinyin !== "string") continue;
      items.push({
        word: o.word,
        pinyin: o.pinyin,
        explanation: typeof o.explanation === "string" ? o.explanation : "",
      });
    }
    return LexiconBaker.bake(items, fourCharOnly);
  },

  bake(items: readonly IdiomInput[], fourCharOnly = false): { builder: IdiomTableBuilder; stats: BakeStats } {
    const builder = new IdiomTableBuilder();
    const stats: BakeStats = { total: 0, valid: 0, invalid: 0, empty: 0, droppedNotFourChar: 0 };
    for (const item of items) {
      const rawWord = item.word;
      const rawPinyin = item.pinyin;
      if (fourCharOnly && codePointCount(rawWord) !== 4) {
        stats.droppedNotFourChar += 1;
        continue;
      }
      const word = trimUnicodeWhitespace(rawWord);
      if (word.length === 0) continue;
      const explanation = trimUnicodeWhitespace(item.explanation);
      const pinyin = normalizePinyinInput(rawPinyin);
      stats.total += 1;
      if (pinyin.length === 0) {
        builder.append(word, null, ReadingFlag.empty, explanation);
        stats.empty += 1;
      } else {
        const chars = buildChars(word, pinyin);
        if (chars !== null) {
          builder.append(word, chars, ReadingFlag.valid, explanation);
          stats.valid += 1;
        } else {
          builder.append(word, null, ReadingFlag.invalid, explanation);
          stats.invalid += 1;
        }
      }
    }
    return { builder, stats };
  },
};

// MARK: - 多源合并

export interface MergeOutput {
  builder: IdiomTableBuilder;
  /** 合并后因读音无效 / 为空而被丢弃的词数（桌面同样会丢） */
  dropped: number;
}

export const LexiconMerger = {
  /**
   * 合并多源。`tables` 按优先级降序（第 0 位最高）。
   *
   * 与桌面完全一致：从最低优先级开始依次并入。词首次出现的位置决定输出顺序；
   * 之后遇到同词：非空拼音覆盖读音，非空释义覆盖释义（空则保留低优先级的）。
   * 合并结束后，读音无效或为空的词整条丢弃。
   */
  merge(tables: readonly IdiomTable[]): MergeOutput {
    const index = new Map<string, number>();
    // 每个词槽：词面来源 / 读音来源 / 释义来源（表下标 + 行号）
    const scalarsTable: number[] = [];
    const scalarsRow: number[] = [];
    const readTable: number[] = [];
    const readRow: number[] = [];
    const explTable: number[] = [];
    const explRow: number[] = [];
    for (let t = tables.length - 1; t >= 0; t--) {
      const table = tables[t];
      const scalars = table.scalars;
      const sylStart = table.sylStart;
      for (let r = 0; r < table.count; r++) {
        const mapKey = exactWordKey(scalars, sylStart[r], sylStart[r + 1]);
        const idx = index.get(mapKey);
        if (idx !== undefined) {
          if (table.flag(r) !== ReadingFlag.empty) {
            readTable[idx] = t;
            readRow[idx] = r;
          }
          if (table.hasExplanation(r)) {
            explTable[idx] = t;
            explRow[idx] = r;
          }
        } else {
          index.set(mapKey, scalarsTable.length);
          scalarsTable.push(t);
          scalarsRow.push(r);
          readTable.push(t);
          readRow.push(r);
          explTable.push(t);
          explRow.push(r);
        }
      }
    }
    const builder = new IdiomTableBuilder();
    let dropped = 0;
    for (let i = 0; i < scalarsTable.length; i++) {
      const rt = tables[readTable[i]];
      if (rt.flag(readRow[i]) !== ReadingFlag.valid) {
        dropped += 1;
        continue;
      }
      builder.appendRow(
        tables[scalarsTable[i]],
        scalarsRow[i],
        rt,
        readRow[i],
        tables[explTable[i]],
        explRow[i],
      );
    }
    return { builder, dropped };
  },
};

/**
 * 词面的精确键：全是 BMP 合法字符时就是词面本身；含非 BMP / 非法标量时用标量值拼成，
 * 保证不同的标量序列不会撞成同一个键（`scalarsToString` 会丢掉非法标量）。
 */
function exactWordKey(scalars: Uint32Array, start: number, end: number): string {
  for (let k = start; k < end; k++) {
    const v = scalars[k];
    if (v > 0xffff || (v >= 0xd800 && v <= 0xdfff)) {
      let key = "\u0000";
      for (let j = start; j < end; j++) key += scalars[j].toString(16) + ",";
      return key;
    }
  }
  return scalarsToString(scalars, start, end - start);
}

// MARK: - 用户改动

export type LexiconEditKind = "set" | "delete";

export interface LexiconEdit {
  word: string;
  kind: LexiconEditKind;
  /** `set` 时的拼音（任意写法，应用时规范化） */
  pinyin: string | null;
  /** `set` 时的释义；null 表示保留已有释义（仅改读音） */
  explanation: string | null;
}

/** 用户对词库的改动（新增 / 改读音 / 删除）。独立于所选内置源保存，切换词库后依然生效。 */
export class LexiconEdits {
  items: LexiconEdit[];

  constructor(items: LexiconEdit[] = []) {
    this.items = items;
  }

  get isEmpty(): boolean {
    return this.items.length === 0;
  }

  clone(): LexiconEdits {
    return new LexiconEdits(this.items.map((e) => ({ ...e })));
  }

  /** 新增或改读音。同词的旧改动被覆盖，但保留其原有位置（新增词按首次加入顺序追加到末尾）。 */
  set(word: string, pinyin: string, explanation: string | null): void {
    this.upsert({ word, kind: "set", pinyin, explanation });
  }

  delete(word: string): void {
    this.upsert({ word, kind: "delete", pinyin: null, explanation: null });
  }

  private upsert(edit: LexiconEdit): void {
    const i = this.items.findIndex((e) => e.word === edit.word);
    if (i >= 0) {
      // 改读音沿用先前新增时写入的释义
      const merged = { ...edit };
      if (edit.kind === "set" && edit.explanation === null && this.items[i].kind === "set") {
        merged.explanation = this.items[i].explanation;
      }
      this.items[i] = merged;
    } else {
      this.items.push(edit);
    }
  }

  /** 稳定指纹，用作缓存键的一部分（键按字母序、空值省略，与 Swift `sortedKeys` 编码同构）。 */
  get fingerprint(): string {
    const bytes = new TextEncoder().encode(this.encode());
    fnvBytesAsScalars(bytes);
    return hex64(hashOut.hi, hashOut.lo);
  }

  /** 持久化格式（edits.json）：与 Swift `JSONEncoder(.sortedKeys)` 的输出同构，两个版本可互读。 */
  encode(): string {
    const items = this.items.map((e) => {
      const o: Record<string, string> = {};
      if (e.explanation !== null) o.explanation = e.explanation;
      o.kind = e.kind;
      if (e.pinyin !== null) o.pinyin = e.pinyin;
      o.word = e.word;
      return o;
    });
    return JSON.stringify({ items });
  }

  /** 解码 edits.json；结构不对返回 null。 */
  static decode(text: string): LexiconEdits | null {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return null;
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
    const list = (raw as { items?: unknown }).items;
    if (!Array.isArray(list)) return null;
    const items: LexiconEdit[] = [];
    for (const r of list) {
      if (r === null || typeof r !== "object") return null;
      const o = r as Record<string, unknown>;
      if (typeof o.word !== "string") return null;
      if (o.kind !== "set" && o.kind !== "delete") return null;
      if (o.pinyin !== undefined && o.pinyin !== null && typeof o.pinyin !== "string") return null;
      if (o.explanation !== undefined && o.explanation !== null && typeof o.explanation !== "string") return null;
      items.push({
        word: o.word,
        kind: o.kind,
        pinyin: (o.pinyin as string | undefined | null) ?? null,
        explanation: (o.explanation as string | undefined | null) ?? null,
      });
    }
    return new LexiconEdits(items);
  }

  /**
   * 把改动应用到一张（已合并的）表上，得到新表的构建器。
   * 改读音原位替换（保持候选顺序），新增追加到末尾，删除移除。
   */
  apply(table: IdiomTable): IdiomTableBuilder {
    const byRow = new Map<number, LexiconEdit>();
    const appended: LexiconEdit[] = [];
    for (const edit of this.items) {
      const row = table.rowForWord(edit.word);
      if (row !== null) byRow.set(row, edit);
      else if (edit.kind === "set") appended.push(edit);
    }
    const builder = new IdiomTableBuilder();
    for (let r = 0; r < table.count; r++) {
      const edit = byRow.get(r);
      if (edit === undefined) {
        builder.appendRow(table, r, table, r, table, r);
        continue;
      }
      if (edit.kind === "delete") continue;
      const word = table.word(r);
      const chars = buildChars(word, normalizePinyinInput(edit.pinyin ?? ""));
      if (chars !== null) {
        builder.append(word, chars, ReadingFlag.valid, edit.explanation ?? table.explanation(r));
      } else {
        // 新读音无效：保持原条目
        builder.appendRow(table, r, table, r, table, r);
      }
    }
    for (const edit of appended) {
      const word = trimUnicodeWhitespace(edit.word);
      if (word.length === 0) continue;
      const chars = buildChars(word, normalizePinyinInput(edit.pinyin ?? ""));
      if (chars === null) continue;
      builder.append(word, chars, ReadingFlag.valid, edit.explanation ?? "");
    }
    return builder;
  }
}
