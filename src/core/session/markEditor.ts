// 标记的纯变换逻辑，逐行对应桌面 DeducePanel.vue 的 mutateMarkAt / syncComboPresentDisplay / setComboKind。
// 对应 Swift `Session/DeduceMarkEditor.swift`。
// 只处理单个字位的 `PositionMarks`（原地修改），不碰会话状态，便于单测。

import type { MarkState, PositionMarks } from "../model/types";
import {
  isAutoPronunciationAttr,
  setAutoPronunciationAttr,
  syncPronunciationMarksForChar,
} from "../pinyin/polyphone";
import { markAttrAssign, markAttrPronunciation, markAttrValue, type ComboKind, type MarkAttr } from "./types";

export type MarkAction =
  /** 左键：对 ↔ 无 */
  | { readonly kind: "hitToggle" }
  /** 右键：偏（已是偏则变无）；组合则按 组 → 组调 → 无 循环 */
  | { readonly kind: "presentToggle" }
  /** 「详细」弹层里直接设某状态；再点同一状态则撤回为未选 */
  | { readonly kind: "set"; readonly mark: MarkState }
  /** 左右键同按：清除为未选 */
  | { readonly kind: "clear" };

/** 对应桌面 `mutateMarkAt`。 */
export function mutateMark(m: PositionMarks, attr: MarkAttr, action: MarkAction): void {
  // 声 / 韵 / 调：人工操作（set、clear）或点在自动带出的值上，都会让它脱离「自动」状态
  const pa = markAttrPronunciation(attr);
  if (pa !== null) {
    const manualEdit = action.kind === "set" || action.kind === "clear";
    if (manualEdit || isAutoPronunciationAttr(m, pa)) {
      setAutoPronunciationAttr(m, pa, false);
    }
  }

  switch (action.kind) {
    case "clear":
      markAttrAssign(attr, null, m);
      if (attr === "combo") m.comboTone = false;
      break;
    case "hitToggle":
      markAttrAssign(attr, markAttrValue(attr, m) === "hit" ? "absent" : "hit", m);
      if (attr === "combo") m.comboTone = false;
      break;
    case "presentToggle":
      if (attr === "combo") {
        // 右键循环：无 → 组(声韵) → 组调(声韵调) → 无
        if (m.combo !== "present") {
          m.combo = "present";
          m.comboTone = false;
        } else if (!m.comboTone) {
          m.comboTone = true;
        } else {
          m.combo = "absent";
          m.comboTone = false;
        }
      } else {
        markAttrAssign(attr, markAttrValue(attr, m) === "present" ? "absent" : "present", m);
      }
      break;
    case "set":
      markAttrAssign(attr, markAttrValue(attr, m) === action.mark ? null : action.mark, m);
      if (attr === "combo" && m.combo !== "present") m.comboTone = false;
      break;
  }

  if (attr === "char") syncPronunciationMarksForChar(m);
  if (attr === "combo") syncComboPresentDisplay(m);
}

/** 组合为「偏」时，让声 / 韵（含调则再加调）同步显示为「偏」（已是「对」的保留）；脱离自动状态。 */
export function syncComboPresentDisplay(m: PositionMarks): void {
  if (m.combo !== "present") {
    m.comboTone = false;
    return;
  }
  if (m.sm !== "hit") {
    m.sm = "present";
    setAutoPronunciationAttr(m, "sm", false);
  }
  if (m.ym !== "hit") {
    m.ym = "present";
    setAutoPronunciationAttr(m, "ym", false);
  }
  if (m.comboTone && m.tone !== "hit") {
    m.tone = "present";
    setAutoPronunciationAttr(m, "tone", false);
  }
}

/** 对应桌面 `setComboKind`。 */
export function setComboKindOnMarks(m: PositionMarks, kind: ComboKind): void {
  switch (kind) {
    case "absent":
      m.combo = "absent";
      m.comboTone = false;
      break;
    case "combo":
      m.combo = "present";
      m.comboTone = false;
      break;
    case "comboTone":
      m.combo = "present";
      m.comboTone = true;
      break;
  }
  syncComboPresentDisplay(m);
}
