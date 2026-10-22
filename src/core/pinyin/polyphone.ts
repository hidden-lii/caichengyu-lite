// 多音字表。对应 Swift `Pinyin/Polyphone.swift`（权威实现：桌面 src-tauri/src/polyphone.rs / src/engine/polyphone.ts）。

import type { CharData, PolyphoneEntry, PolyphoneMap, PolyphoneReading, PositionMarks } from "../model/types";
import { markSyllable, parseSyllable, toneDigit } from "./pinyin";
import { trimUnicodeWhitespace } from "../text";

function toneKeyDigit(tone: number): number {
  return tone >= 1 && tone <= 5 ? tone : 5;
}

export function readingKey(py: string, tone: number): string;
export function readingKey(r: CharData | PolyphoneReading): string;
export function readingKey(a: string | CharData | PolyphoneReading, tone?: number): string {
  if (typeof a === "string") return a + String(toneKeyDigit(tone ?? 5));
  return a.py + String(toneKeyDigit(a.tone));
}

export function parseReading(syl: string): PolyphoneReading | null {
  const trimmed = trimUnicodeWhitespace(syl);
  if (trimmed.length === 0) return null;
  const parsed = parseSyllable(trimmed);
  if (parsed.py.length === 0) return null;
  return { py: parsed.py, sm: parsed.sm, ym: parsed.ym, tone: parsed.tone };
}

/**
 * 解析 `polyphones.json`：`{ "阿": { "default": "ē", "alts": ["ā"] } }`。
 * 非法音节跳过；没有备选读音的字不进表；整体不是合法结构时返回空表（与 Swift `try?` 解码失败一致）。
 */
export function buildPolyphoneMap(jsonText: string): PolyphoneMap {
  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    return new Map();
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return new Map();
  const entries = Object.entries(raw as Record<string, unknown>);
  // Swift 的 Decodable 只要有一项结构不对就整体失败
  for (const [, v] of entries) {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return new Map();
    const e = v as Record<string, unknown>;
    if (typeof e.default !== "string") return new Map();
    if (e.alts !== undefined && e.alts !== null) {
      if (!Array.isArray(e.alts) || e.alts.some((a) => typeof a !== "string")) return new Map();
    }
  }
  const map = new Map<string, PolyphoneEntry>();
  for (const [char, v] of entries) {
    if (char.length === 0) continue;
    const e = v as { default: string; alts?: string[] | null };
    const def = parseReading(e.default);
    if (def === null) continue;
    const seen = new Set<string>([readingKey(def)]);
    const alts: PolyphoneReading[] = [];
    for (const alt of e.alts ?? []) {
      const parsed = parseReading(alt);
      if (parsed === null) continue;
      const key = readingKey(parsed);
      if (seen.has(key)) continue;
      seen.add(key);
      alts.push(parsed);
    }
    if (alts.length === 0) continue;
    map.set(char, { char, default: def, alts });
  }
  return map;
}

/** 某位成语默认音 + 该字多音表中的其余读音（默认位读音在前）。 */
export function readingsForChar(ch: CharData, polyMap: PolyphoneMap | null | undefined): CharData[] {
  const out: CharData[] = [ch];
  const seen = new Set<string>([readingKey(ch)]);
  const entry = polyMap?.get(ch.c);
  if (!entry) return out;
  for (const r of [entry.default, ...entry.alts]) {
    const key = readingKey(r);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ c: ch.c, py: r.py, sm: r.sm, ym: r.ym, tone: r.tone });
  }
  return out;
}

/** 按谓词从多音中选一个；都不满足则返回默认位读音。 */
export function pickReading(
  ch: CharData,
  polyMap: PolyphoneMap | null | undefined,
  pred: (r: CharData) => boolean,
): CharData {
  const readings = readingsForChar(ch, polyMap);
  return readings.find(pred) ?? readings[0];
}

/**
 * 展示用读音：未标调（轻声）的音节若能在多音表里找到同音节的实际声调就补上调号，
 * 真正的轻声字保持原样。只影响展示，不参与筛选。
 */
export function charsToDisplayPinyin(chars: readonly CharData[], polyMap: PolyphoneMap | null | undefined): string {
  return chars
    .map((ch) => {
      if (ch.tone >= 1 && ch.tone <= 4) return markSyllable(ch.py + String(ch.tone));
      const entry = polyMap?.get(ch.c);
      const toned = entry
        ? [entry.default, ...entry.alts].find((r) => r.py === ch.py && r.tone >= 1 && r.tone <= 4)
        : undefined;
      return markSyllable((toned?.py ?? ch.py) + toneDigit(toned?.tone ?? ch.tone));
    })
    .join(" ");
}

export function formatReading(r: PolyphoneReading | CharData): string {
  return markSyllable(r.py + toneDigit(r.tone));
}

export function formatReadingDigit(r: PolyphoneReading | CharData): string {
  return r.py + String(toneKeyDigit(r.tone));
}

// MARK: - 标记辅助（对应桌面 pinyin.ts 的 DEDUCE_ATTRS 与自动带出声韵调逻辑）

export type PronunciationAttr = "sm" | "ym" | "tone";

export const pronunciationAttrs: readonly PronunciationAttr[] = ["sm", "ym", "tone"];

export function charOwnsPronunciation(marks: PositionMarks): boolean {
  return marks.char === "hit" || marks.char === "present";
}

export function isAutoPronunciationAttr(marks: PositionMarks, attr: PronunciationAttr): boolean {
  switch (attr) {
    case "sm":
      return marks.autoSm;
    case "ym":
      return marks.autoYm;
    case "tone":
      return marks.autoTone;
  }
}

export function setAutoPronunciationAttr(marks: PositionMarks, attr: PronunciationAttr, auto: boolean): void {
  switch (attr) {
    case "sm":
      marks.autoSm = auto;
      break;
    case "ym":
      marks.autoYm = auto;
      break;
    case "tone":
      marks.autoTone = auto;
      break;
  }
}

/** 字标为存在（对/偏）时，自动带出声韵调（浅色）；已人选的不覆盖。字取消后撤回自动带出的部分。 */
export function syncPronunciationMarksForChar(marksAt: PositionMarks): void {
  if (marksAt.char === "hit" || marksAt.char === "present") {
    for (const attr of pronunciationAttrs) {
      const manual = marksAt[attr] !== null && !isAutoPronunciationAttr(marksAt, attr);
      if (manual) continue;
      marksAt[attr] = marksAt.char;
      setAutoPronunciationAttr(marksAt, attr, true);
    }
    return;
  }
  for (const attr of pronunciationAttrs) {
    if (isAutoPronunciationAttr(marksAt, attr)) {
      marksAt[attr] = null;
      setAutoPronunciationAttr(marksAt, attr, false);
    }
  }
}
