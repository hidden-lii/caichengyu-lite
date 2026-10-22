// 集成测试：真实词库（public/lexicon/merged.idx + polyphones.json）上走一轮「弹无虚发」猜测。
// 对应 Swift `DeduceSessionIntegrationTests.swift`。

import { describe, expect, it } from "vitest";
import type { CharData, MarkState } from "../../src/core/model/types";
import { DeduceSession } from "../../src/core/session/session";
import { draftTarget as draft } from "../../src/core/session/types";
import {
  DeduceSessionPersistProbe,
  deduceSessionRealLexicon,
  makeDeduceSession,
} from "./support/sessionSupport";

/** 一位上的 字 / 声 / 韵 / 调 四个判定。 */
interface SlotJudgement {
  char: MarkState;
  sm: MarkState;
  ym: MarkState;
  tone: MarkState;
}

/** Wordle 式判定：同位相等 → 对；答案别处出现 → 偏；否则无。 */
function judge(guess: readonly CharData[], answer: readonly CharData[]): SlotJudgement[] {
  const state = (same: boolean, elsewhere: boolean): MarkState => (same ? "hit" : elsewhere ? "present" : "absent");
  return guess.map((g, i) => ({
    char: state(g.c === answer[i].c, answer.some((a) => a.c === g.c)),
    sm: state(g.sm === answer[i].sm, answer.some((a) => a.sm === g.sm)),
    ym: state(g.ym === answer[i].ym, answer.some((a) => a.ym === g.ym)),
    tone: state(g.tone === answer[i].tone, answer.some((a) => a.tone === g.tone)),
  }));
}

/** 用「详细」弹层的按钮把判定打到标记台上（先字、再声韵调）。 */
function apply(judgement: SlotJudgement[], s: DeduceSession): void {
  judgement.forEach((j, pos) => {
    s.setMark(pos, "char", j.char);
    s.setMark(pos, "sm", j.sm);
    s.setMark(pos, "ym", j.ym);
    s.setMark(pos, "tone", j.tone);
  });
}

describe("DeduceSession · 真实词库集成", () => {
  it("一整轮「弹无虚发」找到答案", async () => {
    const lex = deduceSessionRealLexicon();
    const persist = new DeduceSessionPersistProbe();
    const s = makeDeduceSession(lex, { persist, debounceMs: DeduceSession.defaultFilterDebounceMs });

    // 1. 加载已收录词
    s.state.wordInput = "弹无虚发";
    s.loadWord();
    const d = s.state.draft;
    expect(d, s.state.message?.text).not.toBeNull();
    expect(d!.chars.map((c) => c.c)).toEqual(["弹", "无", "虚", "发"]);
    expect(s.state.pinyinInput).toBe("dan4 wu2 xu1 fa1");
    expect(s.state.persistDialog).toBeNull();

    // 2. 答案是「无中生有」：按 Wordle 规则打标记，草稿预览立即参与筛选
    const answer = "无中生有";
    const answerRow = lex.table.rowForWord(answer) as number;
    const answerChars = lex.table.chars(answerRow);
    const judgement = judge(d!.chars, answerChars);
    expect(judgement.map((j) => j.char)).toEqual(["absent", "present", "absent", "absent"]);
    apply(judgement, s);

    await s.waitForFilter();
    expect(s.state.total).toBeGreaterThan(0);
    expect(s.resultsMeta.includes("（含当前编辑预览）"), s.resultsMeta).toBe(true);
    expect(s.state.busy).toBe(false);
    const allBefore = await s.copyAllCandidates();
    expect(allBefore, `预览阶段候选应包含答案，共 ${allBefore.length} 条`).toContain(answer);
    expect(allBefore.length).toBe(s.state.total);

    // 3. 确认本条：记录的标记已定稿，答案仍在候选里
    expect(s.commitGuess()).toBe(true);
    expect(s.state.guesses.length).toBe(1);
    expect(s.state.guesses[0].marks.map((m) => m.char)).toEqual(judgement.map((j) => j.char));
    expect(s.state.guesses[0].marks.map((m) => m.sm)).toEqual(judgement.map((j) => j.sm));
    expect(s.state.guesses[0].marks.map((m) => m.ym)).toEqual(judgement.map((j) => j.ym));
    expect(s.state.guesses[0].marks.map((m) => m.tone)).toEqual(judgement.map((j) => j.tone));
    await s.waitForFilter();
    expect(s.resultsMeta.startsWith(`合并 1 条猜测后，共 ${s.state.total} 条候选`), s.resultsMeta).toBe(true);
    expect(s.resultsMeta.includes("预览")).toBe(false);
    const allAfter = await s.copyAllCandidates();
    expect(allAfter).toContain(answer);
    expect(allAfter, "确认前后候选一致").toEqual(allBefore);
    expect(s.state.items.length).toBeLessThanOrEqual(DeduceSession.resultLimit);

    // 4. 候选里点中答案：载入标记台、返回要复制的词面；展示拼音带调；释义按需读取
    const item = s.state.items.find((i) => i.word === answer);
    if (item) {
      expect(item.pinyin).toBe("wú zhōng shēng yǒu");
      expect(s.explanation(item)).toBe(lex.table.explanation(item.row));
    }
    expect(s.selectCandidate(answer)).toBe(answer);
    expect(s.state.draft?.word).toBe(answer);
    expect(s.state.draft?.chars).toEqual(answerChars);
    expect(s.state.message).toEqual({ text: "已选中并复制「无中生有」", kind: "ok" });

    // 5. 全对：只剩答案自己（多音字展开时也不丢）
    for (let pos = 0; pos < 4; pos++) s.toggleMark(draft, pos, "char");
    await s.waitForFilter();
    const onlyAnswer = await s.copyAllCandidates();
    expect(onlyAnswer).toContain(answer);
    expect(onlyAnswer.length).toBeLessThanOrEqual(allAfter.length);
    s.includePolyphones = true;
    await s.waitForFilter();
    const withPoly = await s.copyAllCandidates();
    expect(withPoly).toContain(answer);
    expect(s.resultsMeta.includes("（含多音字）"), s.resultsMeta).toBe(true);

    // 整个流程没有触发过写库
    expect(persist.requests).toEqual([]);
  });

  it("两条猜测让候选单调收窄", async () => {
    const lex = deduceSessionRealLexicon();
    const s = makeDeduceSession(lex, { debounceMs: 0 });
    const answer = "百发百中";
    const answerChars = lex.table.chars(lex.table.rowForWord(answer) as number);

    let previousTotal = Number.MAX_SAFE_INTEGER;
    for (const guess of ["弹无虚发", "一心一意"]) {
      s.loadWord(guess);
      const d = s.state.draft!;
      apply(judge(d.chars, answerChars), s);
      expect(s.commitGuess()).toBe(true);
      await s.waitForFilter();
      expect(s.state.total, "每多一条猜测，候选只会变少或不变").toBeLessThanOrEqual(previousTotal);
      previousTotal = s.state.total;
      const words = await s.copyAllCandidates();
      expect(words, `${guess} 之后答案仍在候选里（共 ${words.length} 条）`).toContain(answer);
    }
    expect(s.state.guesses.map((g) => g.word)).toEqual(["弹无虚发", "一心一意"]);
    expect(s.resultsMeta.startsWith("合并 2 条猜测后"), s.resultsMeta).toBe(true);

    // 取消选择 / 清空全部
    s.loadWord("百发百中");
    s.clearSelection();
    expect(s.state.guesses.length).toBe(2);
    s.requestClearAll();
    expect(s.state.clearConfirmOpen).toBe(true);
    s.confirmClearAll();
    expect(s.state.guesses).toEqual([]);
    expect(s.state.items).toEqual([]);
  });

  it("词库没有的词：手填拼音后请求新增", async () => {
    const lex = deduceSessionRealLexicon();
    const persist = new DeduceSessionPersistProbe();
    const s = makeDeduceSession(lex, { persist, debounceMs: 0 });
    // 乱造一个词库里肯定没有的「成语」
    const word = "龘龘龘龘";
    expect(lex.table.rowForWord(word)).toBeNull();
    s.state.wordInput = word;
    s.loadWord();
    expect(s.state.draft).toBeNull();
    expect(s.state.showPinyinBar).toBe(true);
    s.state.pinyinInput = "da2 da2 da2 da2";
    s.applyPinyin();
    expect(s.state.persistDialog?.mode).toBe("add");
    await s.confirmPersistPinyin();
    expect(persist.requests).toEqual([{ word, pinyin: "dá dá dá dá", mode: "add" }]);
  });
});
