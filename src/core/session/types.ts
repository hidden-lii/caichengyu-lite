// 「猜成语」会话（DeduceSession）用到的公共类型。对应 Swift `Session/DeduceSessionTypes.swift`。
// 对应桌面 src/components/DeducePanel.vue 里的面板状态；与 UI 无关。

import type { CharData, PolyphoneMap, PositionMarks } from "../model/types";
import type { PronunciationAttr } from "../pinyin/polyphone";
import type { IdiomTable } from "../lexicon/idiomTable";
import type { MarkState } from "../model/types";

// MARK: - 依赖注入

/** 会话读取的词库快照：成语表 + 多音字表。写库后换一个新快照给 `DeduceSession.lexicon` 即可。 */
export interface DeduceLexicon {
  readonly table: IdiomTable;
  readonly polyMap: PolyphoneMap;
}

/** 请求把读音写进词库（新增 / 更新）。`pinyin` 是规范化后的带调号拼音，同桌面传给 `addIdiom` / `updateIdiomPinyin` 的值。 */
export type PersistMode = "add" | "update";

export interface PersistRequest {
  word: string;
  pinyin: string;
  mode: PersistMode;
}

/** 写库结果。失败时 `message` 为错误文案（空串则用默认文案）。 */
export interface PersistOutcome {
  ok: boolean;
  message: string;
}

// MARK: - 展示状态

export type DeduceMessageKind = "ok" | "warn" | "err";

/** 面板顶部的提示文案（桌面 `commitMsg` + `commitMsgClass`）。 */
export interface DeduceMessage {
  text: string;
  kind: DeduceMessageKind;
}

/** 待确认的写库对话框（桌面 `persistDialog`）。 */
export interface PersistDialog {
  mode: PersistMode;
  word: string;
  /** 规范化后的带调号拼音（写库用） */
  pinyin: string;
  /** 数字调拼音（展示用），如 `dan4 wu2 xu1 fa1` */
  digit: string;
  /** 词库里原有的数字调拼音；仅 `update` 有值 */
  oldDigit: string | null;
}

// 以下文案与桌面对话框一致
export function persistDialogTitle(d: Pick<PersistDialog, "mode">): string {
  return d.mode === "add" ? "写入词库？" : "更新词库读音？";
}

export function persistDialogPrompt(d: Pick<PersistDialog, "mode" | "word" | "digit" | "oldDigit">): string {
  return d.mode === "add"
    ? `词库中没有「${d.word}」。是否按读音 ${d.digit} 新增？`
    : `是否将「${d.word}」的读音从 ${d.oldDigit ?? ""} 更新为 ${d.digit}？`;
}

export function persistDialogConfirmTitle(d: Pick<PersistDialog, "mode">): string {
  return d.mode === "add" ? "写入词库" : "更新词库";
}

export const persistDialogCancelTitle = "只改展示，不写库";

/** 待确认的「以此词重新开始」请求：已记录猜测里的第 `index` 条（`word` 用来在确认时核对下标没有错位）。 */
export interface RestartRequest {
  index: number;
  word: string;
  /** 重新开始会一并清掉的已记录猜测条数 */
  guessCount: number;
}

/** 一条筛选候选。 */
export interface DeduceResultItem {
  /** 词库表中的行号（词库被替换后会失效，释义请走 `DeduceSession.explanation(item)`） */
  readonly row: number;
  readonly word: string;
  /** 展示用带调拼音（`charsToDisplayPinyin`：轻声音节能在多音表里找到同音节声调就补上） */
  readonly pinyin: string;
  /** 按约束解析后的各位读音 */
  readonly chars: readonly CharData[];
}

// MARK: - 标记手势

/** 一个字位上的可标记部件（桌面 `MarkAttr`）。 */
export type MarkAttr = "char" | "sm" | "ym" | "tone" | "combo";

export const markAttrs: readonly MarkAttr[] = ["char", "sm", "ym", "tone", "combo"];

/** 手势作用的对象：当前草稿，或已记录的第 n 条猜测。 */
export type MarkTarget = { readonly kind: "draft" } | { readonly kind: "history"; readonly index: number };

export const draftTarget: MarkTarget = { kind: "draft" };

export function historyTarget(index: number): MarkTarget {
  return { kind: "history", index };
}

/** 「详细」弹层里组合的三个按钮：无 / 组（声韵）/ 组调（声韵调）。 */
export type ComboKind = "absent" | "combo" | "comboTone";

/** 声 / 韵 / 调对应的读音属性；字与组合返回 null */
export function markAttrPronunciation(attr: MarkAttr): PronunciationAttr | null {
  switch (attr) {
    case "sm":
    case "ym":
    case "tone":
      return attr;
    case "char":
    case "combo":
      return null;
  }
}

export function markAttrValue(attr: MarkAttr, m: PositionMarks): MarkState | null {
  return m[attr];
}

export function markAttrAssign(attr: MarkAttr, v: MarkState | null, m: PositionMarks): void {
  m[attr] = v;
}
