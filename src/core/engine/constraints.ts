// 约束合并：把若干条带标记的猜测合并成「固定位 / 存在 / 位置排除 / 全局无」四类约束。
// 对应 Swift `Engine/DeduceConstraints.swift`。
// 权威实现：桌面 src-tauri/src/deduce.rs 的 merge_deduce_constraints（TS 版 src/engine/deduce.ts 与之一致）。
// 这里保持字符串级别的直译，便于逐行对照；热路径用的整数编码在 DeducePlan 里另行编译。

import type { DeduceGuess, MarkState, PositionMarks } from "../model/types";
import { createPositionMarks } from "../model/types";
import {
  charOwnsPronunciation,
  isAutoPronunciationAttr,
  type PronunciationAttr,
} from "../pinyin/polyphone";

/** 某一位被固定的字 / 声母 / 韵母 / 声调。 */
export interface DeduceFixedPos {
  c?: string;
  sm?: string;
  ym?: string;
  tone?: number;
}

export type DeducePresentKind = "char" | "sm" | "ym" | "tone" | "combo";

export interface DeducePresent {
  kind: DeducePresentKind;
  /** 字 / 声母 / 韵母（combo 时为声母）；tone 时未用 */
  valueStr: string;
  valueTone: number;
  /** combo 时的韵母 */
  valueYm: string;
  notAt: number;
}

export type DeduceExcludeKind = "sm" | "ym" | "tone";

/** 某位明确标成「无」时，该位禁止出现该值（即使同值在别处对/偏而不能进全局无）。 */
export interface DeduceExcludeAt {
  kind: DeduceExcludeKind;
  valueStr: string;
  valueTone: number;
  at: number;
}

export interface DeduceMerged {
  fixed: (DeduceFixedPos | null)[];
  present: DeducePresent[];
  excludeAt: DeduceExcludeAt[];
  absentChar: Set<string>;
  absentSm: Set<string>;
  absentYm: Set<string>;
  absentTone: Set<number>;
  /** 最后一条猜测的字数；0 表示不限字数 */
  len: number;
}

function markState(v: MarkState | null): MarkState {
  return v ?? "absent";
}

function attrValue(m: PositionMarks, key: PronunciationAttr): MarkState | null {
  return m[key];
}

export function mergeDeduceConstraints(guesses: readonly DeduceGuess[]): DeduceMerged {
  const out: DeduceMerged = {
    fixed: [],
    present: [],
    excludeAt: [],
    absentChar: new Set(),
    absentSm: new Set(),
    absentYm: new Set(),
    absentTone: new Set(),
    len: 0,
  };
  // 「拥有」的音素：字被对/偏时带出的声韵调。零声母（空串）与 0 调不进 owned。
  const ownedSm = new Set<string>();
  const ownedYm = new Set<string>();
  const ownedTone = new Set<number>();
  const emptyMarks = createPositionMarks();

  const own = (ch: { sm: string; ym: string; tone: number }): void => {
    if (ch.sm.length > 0) ownedSm.add(ch.sm);
    if (ch.ym.length > 0) ownedYm.add(ch.ym);
    if (ch.tone !== 0) ownedTone.add(ch.tone);
  };

  for (const g of guesses) {
    out.len = g.chars.length;
    while (out.fixed.length < out.len) out.fixed.push(null);
    // marks 比 chars 短时按「全无」处理（与 Rust 一致，不崩溃）
    for (let i = 0; i < g.chars.length; i++) {
      const marks = i < g.marks.length ? g.marks[i] : emptyMarks;
      const ch = g.chars[i];
      switch (markState(marks.char)) {
        case "hit": {
          const slot = out.fixed[i] ?? {};
          slot.c = ch.c;
          out.fixed[i] = slot;
          own(ch);
          break;
        }
        case "present":
          out.present.push({ kind: "char", valueStr: ch.c, valueTone: 0, valueYm: "", notAt: i });
          own(ch);
          break;
        case "absent":
          out.absentChar.add(ch.c);
          break;
      }
    }
  }

  const isOwned = (key: PronunciationAttr, str: string, tone: number): boolean => {
    switch (key) {
      case "tone":
        return ownedTone.has(tone);
      case "sm":
        return ownedSm.has(str);
      case "ym":
        return ownedYm.has(str);
    }
  };

  for (const g of guesses) {
    for (let i = 0; i < g.chars.length; i++) {
      const marks = i < g.marks.length ? g.marks[i] : emptyMarks;
      // 只跳过「本条猜测自己把这一位的字标成对」的位置：字已定，它的声韵调标记是冗余的。
      //
      // 不能按位置跨猜测跳过（桌面 TS/Rust 的 charFixed 就是这么做的）：另一条猜测在这一位上放的是别的字，
      // 它的声/韵/调标记（尤其是「偏」）有独立信息。丢掉「偏」之后，同条猜测里按 Wordle 重复规则标「无」的
      // 同值音素会进全局排除，把答案里真实存在的声/韵/调误杀。见 tools/desktop-patches/README.md。
      if (markState(marks.char) === "hit") continue;
      const ch = g.chars[i];
      const comboState = markState(marks.combo);
      const comboTone = comboState === "present" && marks.comboTone;
      if (comboState === "present") {
        out.present.push({
          kind: "combo",
          valueStr: ch.sm,
          valueTone: comboTone ? ch.tone : 0,
          valueYm: ch.ym,
          notAt: i,
        });
        if (ch.sm.length > 0) ownedSm.add(ch.sm);
        if (ch.ym.length > 0) ownedYm.add(ch.ym);
        if (comboTone && ch.tone > 0) ownedTone.add(ch.tone);
      }
      for (const key of ["sm", "ym", "tone"] as const) {
        // 字带出的自动声韵调只参与 owned，不生成固定 / 偏移 / 排除；人选标记优先
        if (isAutoPronunciationAttr(marks, key)) continue;
        if (charOwnsPronunciation(marks) && attrValue(marks, key) === null) continue;
        const state = markState(attrValue(marks, key));
        // 组合偏已约束同字共现，不再发独立声/韵 present；含调组合再抑制独立 tone present
        if (comboState === "present" && state === "present") {
          if (key === "sm" || key === "ym") continue;
          if (comboTone && key === "tone") continue;
        }
        let rawStr: string;
        let rawTone: number;
        switch (key) {
          case "sm":
            rawStr = ch.sm;
            rawTone = 0;
            break;
          case "ym":
            rawStr = ch.ym;
            rawTone = 0;
            break;
          case "tone":
            rawStr = String(ch.tone);
            rawTone = ch.tone;
            break;
        }

        // 零声母标「无」不产生排除：空串不是可着色音素，否则「安」会误杀「瓯」
        if (key === "sm" && rawStr.length === 0 && state === "absent") continue;

        if ((state === "present" || state === "absent") && isOwned(key, rawStr, rawTone)) {
          // 同值已被字命中/偏移「拥有」时不能进全局无；人选「偏」仍生效
          if (state === "absent") {
            out.excludeAt.push({ kind: key, valueStr: rawStr, valueTone: rawTone, at: i });
          } else {
            out.present.push({ kind: key, valueStr: rawStr, valueTone: rawTone, valueYm: "", notAt: i });
          }
          continue;
        }

        switch (state) {
          case "hit": {
            const slot = out.fixed[i] ?? {};
            switch (key) {
              case "sm":
                slot.sm = rawStr;
                break;
              case "ym":
                slot.ym = rawStr;
                break;
              case "tone":
                slot.tone = rawTone;
                break;
            }
            out.fixed[i] = slot;
            break;
          }
          case "absent":
            out.excludeAt.push({ kind: key, valueStr: rawStr, valueTone: rawTone, at: i });
            switch (key) {
              case "tone":
                out.absentTone.add(rawTone);
                break;
              case "sm":
                out.absentSm.add(rawStr);
                break;
              case "ym":
                out.absentYm.add(rawStr);
                break;
            }
            break;
          case "present":
            out.present.push({ kind: key, valueStr: rawStr, valueTone: rawTone, valueYm: "", notAt: i });
            break;
        }
      }
    }
  }

  // 对/偏优先于无：被「拥有」或被要求存在的值不能进全局无
  for (const v of ownedSm) out.absentSm.delete(v);
  for (const v of ownedYm) out.absentYm.delete(v);
  for (const v of ownedTone) out.absentTone.delete(v);
  for (const p of out.present) {
    switch (p.kind) {
      case "char":
        out.absentChar.delete(p.valueStr);
        break;
      case "tone":
        out.absentTone.delete(p.valueTone);
        break;
      case "sm":
        out.absentSm.delete(p.valueStr);
        break;
      case "ym":
        out.absentYm.delete(p.valueStr);
        break;
      case "combo":
        out.absentSm.delete(p.valueStr);
        out.absentYm.delete(p.valueYm);
        if (p.valueTone > 0) out.absentTone.delete(p.valueTone);
        break;
    }
  }

  // 同位置同值若已被固定，去掉与之冲突的 excludeAt
  const fixed = out.fixed;
  out.excludeAt = out.excludeAt.filter((e) => {
    if (e.at >= fixed.length) return true;
    const f = fixed[e.at];
    if (f === null) return true;
    let fvMatch: boolean;
    switch (e.kind) {
      case "sm":
        fvMatch = f.sm === e.valueStr;
        break;
      case "ym":
        fvMatch = f.ym === e.valueStr;
        break;
      case "tone":
        fvMatch = f.tone === e.valueTone;
        break;
    }
    return !fvMatch;
  });

  // 已固定的字 / 声 / 韵 / 调同样不能进全局无（Rust deduce_filter_with 开头的那一步）
  for (const f of out.fixed) {
    if (f === null) continue;
    if (f.c !== undefined) out.absentChar.delete(f.c);
    if (f.sm !== undefined) out.absentSm.delete(f.sm);
    if (f.ym !== undefined) out.absentYm.delete(f.ym);
    if (f.tone !== undefined) out.absentTone.delete(f.tone);
  }
  return out;
}
