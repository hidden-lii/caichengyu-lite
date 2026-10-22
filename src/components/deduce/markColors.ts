// 标记颜色（= Theme.nodeColors）：未选 nodeIdle / ink；人选 hit|present|absent / onMark；自动带出的用浅色。
import type { MarkState } from "../../core";

export interface NodeColors {
  bg: string;
  fg: string;
}

export function nodeColors(state: MarkState | null | undefined, auto: boolean): NodeColors {
  if (state === null || state === undefined) return { bg: "var(--cc-node-idle)", fg: "var(--cc-ink)" };
  if (auto) return { bg: `var(--cc-${state}-auto)`, fg: `var(--cc-${state}-auto-ink)` };
  return { bg: `var(--cc-${state})`, fg: "var(--cc-on-mark)" };
}

/** 对 / 偏 / 无 对应的主色（详细弹层里按钮选中时的底色） */
export function markTint(state: MarkState): string {
  return `var(--cc-${state})`;
}
