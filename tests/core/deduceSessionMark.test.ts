// 标记手势：左键 / 右键 / 左右同按（含抑制窗口）/ 组合循环 / 字标记自动带出声韵调 / 「详细」弹层直设。
// 对应 Swift `DeduceSessionMarkTests.swift`。

import { describe, expect, it } from "vitest";
import { DeduceEngine } from "../../src/core/engine/engine";
import type { PositionMarks } from "../../src/core/model/types";
import { DeduceSession } from "../../src/core/session/session";
import { draftTarget as draft, historyTarget as history, type MarkAttr } from "../../src/core/session/types";
import {
  DeduceSessionClock,
  deduceSessionLexicon,
  itemWords,
  makeDeduceSession,
  snap,
} from "./support/sessionSupport";

function loadedSession(clock = new DeduceSessionClock()): DeduceSession {
  const s = makeDeduceSession(deduceSessionLexicon(), { clock });
  s.loadWord("弹无虚发");
  return s;
}

/** 草稿第 pos 位的标记 */
function m(s: DeduceSession, pos = 0): PositionMarks {
  return s.state.draft!.marks[pos];
}

describe("DeduceSession · 左键 / 右键", () => {
  it("左键：对 ↔ 无", () => {
    const s = loadedSession();
    for (const attr of ["sm", "ym", "tone", "combo"] as MarkAttr[]) {
      expect(m(s)[attr], attr).toBeNull();
      s.toggleMark(draft, 0, attr);
      expect(m(s)[attr], attr).toBe("hit");
      s.toggleMark(draft, 0, attr);
      expect(m(s)[attr], attr).toBe("absent");
      s.toggleMark(draft, 0, attr);
      expect(m(s)[attr], attr).toBe("hit");
    }
  });

  it("右键：偏 ↔ 无", () => {
    const s = loadedSession();
    for (const attr of ["sm", "ym", "tone"] as MarkAttr[]) {
      s.presentMark(draft, 1, attr);
      expect(m(s, 1)[attr], attr).toBe("present");
      s.presentMark(draft, 1, attr);
      expect(m(s, 1)[attr], attr).toBe("absent");
      s.presentMark(draft, 1, attr);
      expect(m(s, 1)[attr], attr).toBe("present");
    }
  });

  it("左右键在 对 与 偏 之间切换", () => {
    const s = loadedSession();
    s.presentMark(draft, 0, "tone");
    s.toggleMark(draft, 0, "tone");
    expect(m(s).tone).toBe("hit");
    s.presentMark(draft, 0, "tone");
    expect(m(s).tone).toBe("present");
  });

  it("手势只影响被点的字位", () => {
    const s = loadedSession();
    s.toggleMark(draft, 2, "ym");
    expect(s.state.draft?.marks.map((x) => x.ym)).toEqual([null, null, "hit", null]);
  });
});

describe("DeduceSession · 字标记带出声韵调", () => {
  it("字对：自动带出并可撤回", () => {
    const s = loadedSession();
    s.toggleMark(draft, 0, "char");
    let x = m(s);
    expect(x.char).toBe("hit");
    expect([x.sm, x.ym, x.tone]).toEqual(["hit", "hit", "hit"]);
    expect([x.autoSm, x.autoYm, x.autoTone]).toEqual([true, true, true]);

    // 字 → 无：撤回自动带出的部分
    s.toggleMark(draft, 0, "char");
    x = m(s);
    expect(x.char).toBe("absent");
    expect([x.sm, x.ym, x.tone]).toEqual([null, null, null]);
    expect([x.autoSm, x.autoYm, x.autoTone]).toEqual([false, false, false]);
  });

  it("字偏：自动带出偏，对 ↔ 偏 切换时跟着变", () => {
    const s = loadedSession();
    s.presentMark(draft, 2, "char");
    const x = m(s, 2);
    expect(x.char).toBe("present");
    expect([x.sm, x.ym, x.tone]).toEqual(["present", "present", "present"]);
    expect(x.autoSm && x.autoYm && x.autoTone).toBe(true);

    // 对 ↔ 偏 之间切换：自动带出的部分跟着变
    s.toggleMark(draft, 2, "char");
    expect([m(s, 2).sm, m(s, 2).ym, m(s, 2).tone]).toEqual(["hit", "hit", "hit"]);
    s.presentMark(draft, 2, "char");
    expect([m(s, 2).sm, m(s, 2).ym, m(s, 2).tone]).toEqual(["present", "present", "present"]);
  });

  it("人选的声韵调不被字覆盖", () => {
    const s = loadedSession();
    // 声母人选为「无」（点两下：未选 → 对 → 无）
    s.toggleMark(draft, 0, "sm");
    s.toggleMark(draft, 0, "sm");
    expect(m(s).sm).toBe("absent");
    expect(m(s).autoSm).toBe(false);

    s.toggleMark(draft, 0, "char");
    let x = m(s);
    expect(x.sm, "人选的不被字覆盖").toBe("absent");
    expect(x.autoSm).toBe(false);
    expect([x.ym, x.tone]).toEqual(["hit", "hit"]);
    expect(x.autoYm && x.autoTone).toBe(true);

    s.toggleMark(draft, 0, "char"); // 字 → 无
    x = m(s);
    expect(x.sm, "人选的保留").toBe("absent");
    expect([x.ym, x.tone], "自动带出的撤回").toEqual([null, null]);
  });

  it("点击自动带出的标记会让它变成人选", () => {
    const s = loadedSession();
    s.toggleMark(draft, 0, "char");
    s.toggleMark(draft, 0, "sm"); // 自动的「对」→ 人选「无」
    expect(m(s).sm).toBe("absent");
    expect(m(s).autoSm).toBe(false);
    s.presentMark(draft, 0, "ym"); // 自动的「对」→ 人选「偏」
    expect(m(s).ym).toBe("present");
    expect(m(s).autoYm).toBe(false);
    expect(m(s).autoTone, "没碰过的仍是自动").toBe(true);
  });
});

describe("DeduceSession · 左右键同按", () => {
  it("清除为未选，字清除后自动带出的一并撤回", () => {
    const s = loadedSession();
    s.toggleMark(draft, 0, "char");
    s.clearMark(draft, 0, "char");
    const x = m(s);
    expect(x.char).toBeNull();
    expect([x.sm, x.ym, x.tone], "字清除后自动带出的一并撤回").toEqual([null, null, null]);
    expect(x.autoSm || x.autoYm || x.autoTone).toBe(false);
  });

  it("对声韵调同按不影响字", () => {
    const s = loadedSession();
    s.toggleMark(draft, 0, "char");
    s.clearMark(draft, 0, "sm");
    expect(m(s).char).toBe("hit");
    expect(m(s).sm).toBeNull();
    expect(m(s).autoSm).toBe(false);
  });

  it("对组合同按重置 comboTone", () => {
    const s = loadedSession();
    s.presentMark(draft, 0, "combo");
    s.presentMark(draft, 0, "combo");
    expect(m(s).comboTone).toBe(true);
    s.clearMark(draft, 0, "combo");
    expect(m(s).combo).toBeNull();
    expect(m(s).comboTone).toBe(false);
  });

  it("同按后 400ms 内忽略 click / contextmenu", () => {
    const clock = new DeduceSessionClock();
    const s = loadedSession(clock);
    expect(s.isMarkGestureSuppressed).toBe(false);

    s.clearMark(draft, 0, "tone");
    expect(s.isMarkGestureSuppressed).toBe(true);
    // 松开按键时浏览器补发的 click / contextmenu 被吞掉
    s.toggleMark(draft, 0, "tone");
    s.presentMark(draft, 0, "tone");
    expect(m(s).tone).toBeNull();

    clock.advance(0.399);
    s.toggleMark(draft, 0, "tone");
    expect(m(s).tone, "窗口内").toBeNull();

    clock.advance(0.001); // 刚好 0.4 秒
    expect(s.isMarkGestureSuppressed).toBe(false);
    s.toggleMark(draft, 0, "tone");
    expect(m(s).tone).toBe("hit");
  });

  it("抑制窗口同样覆盖历史条目，且每次同按重新计时", () => {
    const clock = new DeduceSessionClock();
    const s = loadedSession(clock);
    s.toggleMark(draft, 0, "char");
    s.commitGuess();

    s.clearMark(history(0), 0, "char");
    expect(s.state.guesses[0].marks[0].char).toBeNull();
    s.toggleMark(history(0), 0, "char");
    s.presentMark(history(0), 0, "char");
    expect(s.state.guesses[0].marks[0].char, "历史条目同样被抑制").toBeNull();

    clock.advance(0.3);
    s.clearMark(history(0), 0, "sm"); // 再同按一次，窗口从现在重新计
    clock.advance(0.3);
    expect(s.isMarkGestureSuppressed).toBe(true);
    clock.advance(0.11);
    expect(s.isMarkGestureSuppressed).toBe(false);
  });

  it("「详细」弹层的按钮不受抑制窗口影响", () => {
    const s = loadedSession();
    s.clearMark(draft, 0, "char");
    s.setMark(0, "char", "hit");
    expect(m(s).char).toBe("hit");
    s.setComboKind(0, "combo");
    expect(m(s).combo).toBe("present");
  });
});

describe("DeduceSession · 组合", () => {
  it("右键循环：无 → 组 → 组调 → 无", () => {
    const s = loadedSession();
    expect(DeduceSession.comboNodeLabel(m(s))).toBe("组");

    // 无 → 组(声韵)
    s.presentMark(draft, 0, "combo");
    let x = m(s);
    expect(x.combo).toBe("present");
    expect(x.comboTone).toBe(false);
    expect([x.sm, x.ym], "组合为偏时，声 / 韵显示为偏").toEqual(["present", "present"]);
    expect(x.tone).toBeNull();
    expect(DeduceSession.comboNodeLabel(x)).toBe("组");

    // 组 → 组调(声韵调)
    s.presentMark(draft, 0, "combo");
    x = m(s);
    expect(x.combo).toBe("present");
    expect(x.comboTone).toBe(true);
    expect(x.tone).toBe("present");
    expect(DeduceSession.comboNodeLabel(x)).toBe("组调");

    // 组调 → 无
    s.presentMark(draft, 0, "combo");
    x = m(s);
    expect(x.combo).toBe("absent");
    expect(x.comboTone).toBe(false);
    expect(DeduceSession.comboNodeLabel(x)).toBe("组");

    // 无 → 组，循环
    s.presentMark(draft, 0, "combo");
    expect(m(s).combo).toBe("present");
    expect(m(s).comboTone).toBe(false);
  });

  it("已经是对的部分不会被降成偏", () => {
    const s = loadedSession();
    s.toggleMark(draft, 0, "sm"); // 声母人选「对」
    s.presentMark(draft, 0, "combo");
    expect(m(s).sm, "已是对的不降成偏").toBe("hit");
    expect(m(s).ym).toBe("present");
  });

  it("组合为偏会让声韵的自动标志脱离", () => {
    const s = loadedSession();
    s.presentMark(draft, 0, "char"); // 字偏 → 声韵调自动偏
    expect(m(s).autoSm).toBe(true);
    s.presentMark(draft, 0, "combo");
    expect(m(s).autoSm).toBe(false);
    expect(m(s).autoYm).toBe(false);
    expect(m(s).autoTone, "组(不含调)不动调").toBe(true);
  });

  it("左键切换 对 / 无，并丢掉 comboTone", () => {
    const s = loadedSession();
    s.toggleMark(draft, 0, "combo");
    expect(m(s).combo).toBe("hit");
    s.toggleMark(draft, 0, "combo");
    expect(m(s).combo).toBe("absent");

    s.presentMark(draft, 0, "combo"); // → 组
    s.presentMark(draft, 0, "combo"); // → 组调
    expect(m(s).comboTone).toBe(true);
    s.toggleMark(draft, 0, "combo"); // 组调 → 左键 → 对
    expect(m(s).combo).toBe("hit");
    expect(m(s).comboTone).toBe(false);
  });

  it("弹层里的 组 / 组调 / 无 按钮", () => {
    const s = loadedSession();
    s.setComboKind(1, "comboTone");
    let x = m(s, 1);
    expect(x.combo).toBe("present");
    expect(x.comboTone).toBe(true);
    expect([x.sm, x.ym, x.tone]).toEqual(["present", "present", "present"]);

    s.setComboKind(1, "combo");
    x = m(s, 1);
    expect(x.combo).toBe("present");
    expect(x.comboTone).toBe(false);

    s.setComboKind(1, "absent");
    x = m(s, 1);
    expect(x.combo).toBe("absent");
    expect(x.comboTone).toBe(false);

    s.setComboKind(9, "combo"); // 越界忽略
    expect(s.state.draft?.marks.length).toBe(4);
  });
});

describe("DeduceSession · 「详细」弹层直设", () => {
  it("设置状态，再点同一状态撤回为未选", () => {
    const s = loadedSession();
    s.setMark(0, "char", "present");
    expect(m(s).char).toBe("present");
    expect([m(s).sm, m(s).ym, m(s).tone]).toEqual(["present", "present", "present"]);

    s.setMark(0, "char", "present"); // 再点同一状态 → 撤回为未选
    expect(m(s).char).toBeNull();
    expect([m(s).sm, m(s).ym, m(s).tone]).toEqual([null, null, null]);

    s.setMark(1, "ym", "absent");
    expect(m(s, 1).ym).toBe("absent");
    expect(m(s, 1).autoYm).toBe(false);
    s.setMark(1, "ym", "hit");
    expect(m(s, 1).ym).toBe("hit");
  });

  /**
   * 桌面遗留行为（照搬）：在「自动带出」的声韵调上点与当前值相同的状态，会先脱离自动、再被当成「再点一次」撤回为未选；
   * 定稿时未选的声韵调仍会跟随字，所以对筛选结果没有影响，只是弹层里要点第二下才变成人选。
   */
  it("在自动带出的值上点相同状态：先撤回为未选（桌面行为）", () => {
    const s = loadedSession();
    s.toggleMark(draft, 0, "char");
    s.setMark(0, "sm", "hit");
    expect(m(s).sm).toBeNull();
    expect(m(s).autoSm).toBe(false);
    expect(DeduceEngine.finalizeMarks([m(s)])[0].sm, "定稿后仍跟随字").toBe("hit");
    s.setMark(0, "sm", "hit");
    expect(m(s).sm).toBe("hit");
    expect(m(s).autoSm, "第二下才是人选").toBe(false);
  });

  it("在自动带出的值上点不同状态：变成人选", () => {
    const s = loadedSession();
    s.toggleMark(draft, 0, "char");
    s.setMark(0, "tone", "absent");
    expect(m(s).tone).toBe("absent");
    expect(m(s).autoTone).toBe(false);
    expect(DeduceEngine.finalizeMarks([m(s)])[0].tone).toBe("absent");
  });
});

describe("DeduceSession · 已记录猜测上的手势", () => {
  it("原位修改已记录的标记，并同步筛选结果", async () => {
    const s = loadedSession();
    s.toggleMark(draft, 0, "char");
    s.commitGuess();
    expect(s.state.guesses[0].marks[1].char, "提交时未选的定稿为无").toBe("absent");

    s.toggleMark(history(0), 1, "char");
    expect(s.state.guesses[0].marks[1].char).toBe("hit");
    s.presentMark(history(0), 1, "char");
    expect(s.state.guesses[0].marks[1].char).toBe("present");
    s.clearMark(history(0), 1, "char");
    expect(s.state.guesses[0].marks[1].char).toBeNull();

    // 改标记后筛选结果同步更新
    await s.waitForFilter();
    const engine = DeduceEngine.filter({
      table: s.lexicon.table,
      guesses: s.activeGuesses,
      polyMap: s.lexicon.polyMap,
      limit: 200,
    });
    expect(itemWords(s)).toEqual(engine?.items.map((i) => i.word));
    expect(s.state.total).toBe(engine?.total);
  });

  it("正在修改这一条时，标记台上的草稿跟着变", () => {
    const s = loadedSession();
    s.toggleMark(draft, 0, "char");
    s.commitGuess();
    s.editGuess(0);

    s.toggleMark(history(0), 2, "char");
    expect(s.state.draft?.marks, "标记台上的草稿跟着变").toEqual(s.state.guesses[0].marks);

    // 反过来：改草稿不动已记录的那条，直到「更新本条」
    s.toggleMark(draft, 3, "char");
    expect(s.state.draft?.marks).not.toEqual(s.state.guesses[0].marks);
    s.commitGuess();
    expect(s.state.guesses[0].marks[3].char).toBe("hit");
  });

  it("改别的猜测不动草稿", () => {
    const s = loadedSession();
    s.toggleMark(draft, 0, "char");
    s.commitGuess();
    s.loadWord("百发百中");
    const draftBefore = snap(s.state.draft);
    s.toggleMark(history(0), 1, "char");
    expect(s.state.draft).toEqual(draftBefore);
  });

  it("目标不存在时什么都不做", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    // 没有草稿
    s.toggleMark(draft, 0, "char");
    s.presentMark(draft, 0, "char");
    s.clearMark(draft, 0, "char");
    s.setMark(0, "char", "hit");
    s.setComboKind(0, "combo");
    expect(s.state.draft).toBeNull();

    s.loadWord("弹无虚发");
    const before = snap(s.state.draft);
    s.toggleMark(draft, 4, "char");
    s.toggleMark(draft, -1, "char");
    s.toggleMark(history(0), 0, "char");
    s.toggleMark(history(-1), 0, "char");
    expect(s.state.draft).toEqual(before);
    expect(s.state.guesses).toEqual([]);
  });
});
