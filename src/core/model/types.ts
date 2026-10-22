// 数据模型。对应 Swift `Model/Models.swift`。
//
// 约定：
// · Swift 的 Optional 在这里用 `null` 表示（JSON 里缺省 / null 都解码为 null），字段始终存在，便于 Vue 响应式追踪。
// · Swift 是值类型，改动即复制；这里的 `cloneXxx` 用来在「复制 → 修改 → 整体赋回」时保持同样的语义。

/** 单个部件的标记：对 / 偏 / 无。`null` 表示用户尚未选择（筛选时按「无」处理，见 `finalizeMarks`）。 */
export type MarkState = "hit" | "present" | "absent";

/** 一个字在某个读音下的拆解。`py` 为不带调的基础拼音（ü 统一写作 v），恒等于 `sm + ym`。 */
export interface CharData {
  c: string;
  py: string;
  sm: string;
  ym: string;
  /** 1...4 为四声，5 为轻声 */
  tone: number;
}

/** 一个字位上的全部标记。 */
export interface PositionMarks {
  char: MarkState | null;
  sm: MarkState | null;
  ym: MarkState | null;
  tone: MarkState | null;
  /** 声韵组合（拼音下划线）：偏 = 答案中须同字共现该声母+韵母 */
  combo: MarkState | null;
  /** 下划线延伸到调号：同字须共现声+韵+调；仅 `combo === "present"` 时有效 */
  comboTone: boolean;
  /** 声/韵/调是否由「字」的存在标记自动带出（人选可覆盖，冲突以人选为准） */
  autoSm: boolean;
  autoYm: boolean;
  autoTone: boolean;
}

/** 一条已猜测的成语及其逐字标记。 */
export interface DeduceGuess {
  word: string;
  pinyin: string;
  chars: CharData[];
  marks: PositionMarks[];
  editIndex: number | null;
}

/** 词库输入条目（来自 JSON 源或用户新增）。 */
export interface IdiomInput {
  word: string;
  pinyin: string;
  explanation: string;
}

export interface PolyphoneReading {
  py: string;
  sm: string;
  ym: string;
  tone: number;
}

export interface PolyphoneEntry {
  char: string;
  default: PolyphoneReading;
  alts: PolyphoneReading[];
}

/** 多音字表：字 → 默认读音 + 备选读音。 */
export type PolyphoneMap = ReadonlyMap<string, PolyphoneEntry>;

/** 空的多音字表 */
export const emptyPolyMap: PolyphoneMap = new Map();

// MARK: - 构造 / 复制 / 比较

export function createPositionMarks(init: Partial<PositionMarks> = {}): PositionMarks {
  return {
    char: init.char ?? null,
    sm: init.sm ?? null,
    ym: init.ym ?? null,
    tone: init.tone ?? null,
    combo: init.combo ?? null,
    comboTone: init.comboTone ?? false,
    autoSm: init.autoSm ?? false,
    autoYm: init.autoYm ?? false,
    autoTone: init.autoTone ?? false,
  };
}

export function createGuess(init: {
  word: string;
  pinyin: string;
  chars: CharData[];
  marks: PositionMarks[];
  editIndex?: number | null;
}): DeduceGuess {
  return {
    word: init.word,
    pinyin: init.pinyin,
    chars: init.chars,
    marks: init.marks,
    editIndex: init.editIndex ?? null,
  };
}

export function cloneChar(c: CharData): CharData {
  return { c: c.c, py: c.py, sm: c.sm, ym: c.ym, tone: c.tone };
}

export function cloneMarks(m: PositionMarks): PositionMarks {
  return {
    char: m.char,
    sm: m.sm,
    ym: m.ym,
    tone: m.tone,
    combo: m.combo,
    comboTone: m.comboTone,
    autoSm: m.autoSm,
    autoYm: m.autoYm,
    autoTone: m.autoTone,
  };
}

export function cloneGuess(g: DeduceGuess): DeduceGuess {
  return {
    word: g.word,
    pinyin: g.pinyin,
    chars: g.chars.map(cloneChar),
    marks: g.marks.map(cloneMarks),
    editIndex: g.editIndex,
  };
}

export function cloneGuesses(list: readonly DeduceGuess[]): DeduceGuess[] {
  return list.map(cloneGuess);
}

export function charsEqual(a: CharData, b: CharData): boolean {
  return a.c === b.c && a.py === b.py && a.sm === b.sm && a.ym === b.ym && a.tone === b.tone;
}

export function marksEqual(a: PositionMarks, b: PositionMarks): boolean {
  return (
    a.char === b.char &&
    a.sm === b.sm &&
    a.ym === b.ym &&
    a.tone === b.tone &&
    a.combo === b.combo &&
    a.comboTone === b.comboTone &&
    a.autoSm === b.autoSm &&
    a.autoYm === b.autoYm &&
    a.autoTone === b.autoTone
  );
}

export function guessEqual(a: DeduceGuess, b: DeduceGuess): boolean {
  if (a.word !== b.word || a.pinyin !== b.pinyin || a.editIndex !== b.editIndex) return false;
  if (a.chars.length !== b.chars.length || a.marks.length !== b.marks.length) return false;
  for (let i = 0; i < a.chars.length; i++) if (!charsEqual(a.chars[i], b.chars[i])) return false;
  for (let i = 0; i < a.marks.length; i++) if (!marksEqual(a.marks[i], b.marks[i])) return false;
  return true;
}

export function guessesEqual(a: readonly DeduceGuess[], b: readonly DeduceGuess[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!guessEqual(a[i], b[i])) return false;
  return true;
}

// MARK: - 宽松解码（JSON 夹具 / 外部数据）

const MARK_STATES: readonly string[] = ["hit", "present", "absent"];

function decodeMarkState(v: unknown): MarkState | null {
  return typeof v === "string" && MARK_STATES.includes(v) ? (v as MarkState) : null;
}

/** 宽松解码：缺省键按默认值处理（兼容旧数据与外部 golden 夹具）。 */
export function decodePositionMarks(raw: unknown): PositionMarks {
  const o = (raw ?? {}) as Record<string, unknown>;
  return {
    char: decodeMarkState(o.char),
    sm: decodeMarkState(o.sm),
    ym: decodeMarkState(o.ym),
    tone: decodeMarkState(o.tone),
    combo: decodeMarkState(o.combo),
    comboTone: o.comboTone === true,
    autoSm: o.autoSm === true,
    autoYm: o.autoYm === true,
    autoTone: o.autoTone === true,
  };
}

export function decodeChar(raw: unknown): CharData {
  const o = raw as Record<string, unknown>;
  return {
    c: String(o.c ?? ""),
    py: String(o.py ?? ""),
    sm: String(o.sm ?? ""),
    ym: String(o.ym ?? ""),
    tone: Number(o.tone ?? 0),
  };
}

export function decodeGuess(raw: unknown): DeduceGuess {
  const o = raw as Record<string, unknown>;
  return {
    word: String(o.word ?? ""),
    pinyin: String(o.pinyin ?? ""),
    chars: ((o.chars as unknown[]) ?? []).map(decodeChar),
    marks: ((o.marks as unknown[]) ?? []).map(decodePositionMarks),
    editIndex: typeof o.editIndex === "number" ? o.editIndex : null,
  };
}
