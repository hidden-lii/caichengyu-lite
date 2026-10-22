// 已记录猜测的确认 / 更新 / 编辑 / 删除 / 展开，以及取消选择与清空全部。
// 对应 Swift `DeduceSessionGuessTests.swift`。

import { describe, expect, it } from "vitest";
import { DeduceEngine } from "../../src/core/engine/engine";
import { createPositionMarks } from "../../src/core/model/types";
import { DeduceSession } from "../../src/core/session/session";
import { draftTarget as draft } from "../../src/core/session/types";
import {
  DeduceSessionClock,
  deduceSessionLexicon,
  itemWords,
  makeDeduceSession,
  settledWords,
  snap,
} from "./support/sessionSupport";

function sessionWithGuesses(words: string[], clock = new DeduceSessionClock()): DeduceSession {
  const s = makeDeduceSession(deduceSessionLexicon(), { clock });
  for (const w of words) {
    s.loadWord(w);
    s.toggleMark(draft, 0, "char");
    s.commitGuess();
  }
  return s;
}

describe("DeduceSession · 确认", () => {
  it("提交定稿后的猜测并重置标记台", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.toggleMark(draft, 0, "char");
    s.presentMark(draft, 2, "char");
    s.state.showDetailPanel = true;
    expect(s.canCommit).toBe(true);
    expect(s.commitButtonTitle).toBe("确认本条并筛选");

    expect(s.commitGuess()).toBe(true);
    expect(s.state.guesses.length).toBe(1);
    const g = s.state.guesses[0];
    expect(g.word).toBe("弹无虚发");
    expect(g.pinyin).toBe("dàn wú xū fā");
    expect(g.editIndex).toBeNull();
    // 定稿：没有未选；字为对 / 偏的声韵调带出并标记为自动
    expect(g.marks[0].char).toBe("hit");
    expect([g.marks[0].sm, g.marks[0].ym, g.marks[0].tone]).toEqual(["hit", "hit", "hit"]);
    expect(g.marks[0].autoSm).toBe(true);
    expect(g.marks[1]).toEqual(
      createPositionMarks({ char: "absent", sm: "absent", ym: "absent", tone: "absent", combo: "absent" }),
    );
    expect(g.marks[2].char).toBe("present");
    expect(g.marks[2].sm).toBe("present");

    expect(s.state.draft).toBeNull();
    expect(s.state.draftBaseline).toBe("");
    expect(s.state.wordInput).toBe("");
    expect(s.state.showPinyinBar).toBe(false);
    expect(s.state.showDetailPanel).toBe(false);
    expect(s.hasSelection).toBe(false);
    expect(s.canCommit).toBe(false);
    expect(s.state.message).toEqual({ text: "已加入筛选条件", kind: "ok" });
  });

  it("没有草稿时返回 false", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    expect(s.commitGuess()).toBe(false);
    expect(s.state.guesses).toEqual([]);
  });

  it("拼音栏里改过但没应用的读音随提交生效", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.toggleMark(draft, 0, "char");
    s.state.pinyinInput = "tan2 wu2 xu1 fa1"; // 用户在拼音栏里改过但没点应用
    expect(s.commitGuess()).toBe(true);
    expect(s.state.guesses[0].chars[0].py).toBe("tan");
    expect(s.state.guesses[0].pinyin).toBe("tán wú xū fā");
  });

  it("同词面且没有 editIndex：替换并移到末尾", () => {
    const s = sessionWithGuesses(["弹无虚发", "百发百中"]);
    // 让草稿与已记录的「弹无虚发」同词面但没有 editIndex（拼音栏「应用」路径）
    s.state.wordInput = "弹无虚发";
    s.state.pinyinInput = "dan4 wu2 xu1 fa1";
    s.applyPinyin();
    expect(s.state.draft?.editIndex).toBeNull();
    s.presentMark(draft, 1, "char");
    expect(s.commitGuess()).toBe(true);

    expect(s.state.guesses.map((g) => g.word)).toEqual(["百发百中", "弹无虚发"]);
    expect(s.state.guesses[1].marks[1].char).toBe("present");
    expect(s.state.message).toEqual({ text: "已加入筛选条件", kind: "ok" });
  });
});

describe("DeduceSession · 编辑 / 更新", () => {
  it("编辑已记录的猜测：载入标记台", () => {
    const s = sessionWithGuesses(["弹无虚发", "百发百中"]);
    s.editGuess(1);

    const d = s.state.draft!;
    expect(d.word).toBe("百发百中");
    expect(d.editIndex).toBe(1);
    expect(d.marks).toEqual(s.state.guesses[1].marks);
    expect(s.state.wordInput).toBe("百发百中");
    expect(s.state.showPinyinBar).toBe(true);
    expect(s.state.pinyinInput).toBe("bai3 fa1 bai3 zhong4");
    expect(s.state.draftBaseline).toBe("bai3 fa1 bai3 zhong4");
    expect(s.pinyinDirty).toBe(false);
    expect(s.isEditingRecorded).toBe(true);
    expect(s.commitButtonTitle).toBe("更新本条并筛选");
    expect(s.state.message).toEqual({
      text: "正在修改该条：可改标记后点「更新本条并筛选」；读音也可在下方记录里直接改",
      kind: "warn",
    });
    // 草稿是独立副本：改草稿不影响已记录的那条
    s.toggleMark(draft, 3, "char");
    expect(s.state.guesses[1].marks[3].char).toBe("absent");
  });

  it("更新原位替换被编辑的那一条", () => {
    const s = sessionWithGuesses(["弹无虚发", "百发百中"]);
    s.editGuess(0);
    s.presentMark(draft, 3, "char");
    expect(s.commitGuess()).toBe(true);

    expect(s.state.guesses.map((g) => g.word), "位置不变").toEqual(["弹无虚发", "百发百中"]);
    expect(s.state.guesses[0].marks[3].char).toBe("present");
    expect(s.state.guesses[0].editIndex).toBeNull();
    expect(s.state.draft).toBeNull();
    expect(s.state.message).toEqual({ text: "已更新筛选条件", kind: "ok" });
  });

  it("下标越界什么都不做", () => {
    const s = sessionWithGuesses(["弹无虚发"]);
    s.editGuess(3);
    s.editGuess(-1);
    expect(s.state.draft).toBeNull();
  });
});

describe("DeduceSession · 删除 / 展开", () => {
  it("删除一条并重新筛选", async () => {
    const s = sessionWithGuesses(["弹无虚发", "百发百中", "一心一意"]);
    s.removeGuess(1);
    expect(s.state.guesses.map((g) => g.word)).toEqual(["弹无虚发", "一心一意"]);
    s.removeGuess(7);
    s.removeGuess(-1);
    expect(s.state.guesses.length).toBe(2);

    // 筛选条件随之变化
    await s.waitForFilter();
    const engine = DeduceEngine.filter({
      table: s.lexicon.table,
      guesses: s.state.guesses,
      polyMap: s.lexicon.polyMap,
      limit: 200,
    });
    expect(s.state.total).toBe(engine?.total);
    expect(itemWords(s)).toEqual(engine?.items.map((i) => i.word));

    s.removeGuess(0);
    s.removeGuess(0);
    expect(s.state.guesses).toEqual([]);
    expect(s.state.items, "没有任何猜测时立即清空结果").toEqual([]);
    expect(s.state.total).toBe(0);
    expect(s.resultsMeta).toBe("");
  });

  it("删除时修正 editIndex 与展开状态", () => {
    const s = sessionWithGuesses(["弹无虚发", "百发百中", "一心一意"]);
    s.toggleHistoryExpanded(2);
    expect(s.isHistoryExpanded(2)).toBe(true);
    expect(s.isHistoryExpanded(0)).toBe(false);
    s.editGuess(2);

    // 删掉前面的一条：正在修改的条目下标前移，展开状态跟着走
    s.removeGuess(0);
    expect(s.state.draft?.editIndex).toBe(1);
    expect(s.state.guesses[1].word).toBe("一心一意");
    expect(s.isHistoryExpanded(1)).toBe(true);
    expect(s.isHistoryExpanded(2)).toBe(false);
    s.presentMark(draft, 1, "char");
    s.commitGuess();
    expect(s.state.guesses.map((g) => g.word), "更新的是正确的那一条").toEqual(["百发百中", "一心一意"]);
    expect(s.state.guesses[1].marks[1].char).toBe("present");
    expect(s.state.guesses[0].marks[1].char).toBe("absent");

    // 删掉正在修改的那条：草稿转为新增，不会误改别的条目
    s.editGuess(1);
    s.removeGuess(1);
    expect(s.state.draft?.editIndex).toBeNull();
    expect(s.state.guesses.map((g) => g.word)).toEqual(["百发百中"]);
    s.commitGuess();
    expect(s.state.guesses.map((g) => g.word)).toEqual(["百发百中", "一心一意"]);
  });

  it("展开 / 收起", () => {
    const s = sessionWithGuesses(["弹无虚发"]);
    expect(s.isHistoryExpanded(0)).toBe(false);
    s.toggleHistoryExpanded(0);
    expect(s.isHistoryExpanded(0)).toBe(true);
    s.toggleHistoryExpanded(0);
    expect(s.isHistoryExpanded(0)).toBe(false);
  });
});

describe("DeduceSession · 取消选择", () => {
  it("取消选择不动已记录的猜测与结果", async () => {
    const s = sessionWithGuesses(["弹无虚发"]);
    const words = await settledWords(s);
    const total = s.state.total;
    const guesses = snap(s.state.guesses);

    s.loadWord("百发百中");
    s.toggleMark(draft, 0, "char");
    s.state.showDetailPanel = true;
    expect(s.hasSelection).toBe(true);

    s.clearSelection();
    expect(s.state.draft).toBeNull();
    expect(s.state.draftBaseline).toBe("");
    expect(s.state.wordInput).toBe("");
    expect(s.state.pinyinInput).toBe("");
    expect(s.state.showPinyinBar).toBe(false);
    expect(s.state.showDetailPanel).toBe(false);
    expect(s.hasSelection).toBe(false);
    expect(s.state.message).toEqual({ text: "已取消当前选择，已记录的猜测保持不变", kind: "warn" });

    // 已记录的猜测不变；草稿预览撤掉后筛选结果回到只含已记录猜测的状态
    expect(s.state.guesses).toEqual(guesses);
    expect(await settledWords(s)).toEqual(words);
    expect(s.state.total).toBe(total);
  });

  it("修改模式下取消选择不改已记录的猜测", () => {
    const s = sessionWithGuesses(["弹无虚发"]);
    const guesses = snap(s.state.guesses);
    s.editGuess(0);
    s.presentMark(draft, 2, "char"); // 只改草稿
    s.clearSelection();
    expect(s.state.guesses).toEqual(guesses);
  });

  it("hasSelection 跟随输入框与拼音栏", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    expect(s.hasSelection).toBe(false);
    s.state.wordInput = "  ";
    expect(s.hasSelection).toBe(false);
    s.state.wordInput = "弹";
    expect(s.hasSelection).toBe(true);
    s.state.wordInput = "";
    s.state.showPinyinBar = true;
    expect(s.hasSelection).toBe(true);
  });
});

describe("DeduceSession · 清空全部", () => {
  it("没有内容时直接清", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.requestClearAll();
    expect(s.state.clearConfirmOpen).toBe(false);
    expect(s.state.message).toBeNull();
  });

  it("有内容时先弹确认框", async () => {
    const s = sessionWithGuesses(["弹无虚发", "百发百中"]);
    await s.waitForFilter();
    s.loadWord("一心一意");
    expect(s.state.guesses.length).toBeGreaterThan(0);

    s.requestClearAll();
    expect(s.state.clearConfirmOpen).toBe(true);
    expect(s.state.guesses.length, "确认之前什么都不清").toBe(2);
    expect(s.state.draft).not.toBeNull();

    s.cancelClearAll();
    expect(s.state.clearConfirmOpen).toBe(false);
    expect(s.state.guesses.length).toBe(2);

    s.requestClearAll();
    s.confirmClearAll();
    expect(s.state.clearConfirmOpen).toBe(false);
    expect(s.state.guesses).toEqual([]);
    expect(s.state.draft).toBeNull();
    expect(s.state.wordInput).toBe("");
    expect(s.state.showPinyinBar).toBe(false);
    expect(s.state.showDetailPanel).toBe(false);
    expect(s.state.message).toBeNull();
    expect(s.state.items).toEqual([]);
    expect(s.state.total).toBe(0);
    expect(s.state.busy).toBe(false);
    expect(s.resultsMeta).toBe("");
  });

  it("只有输入框有字也要确认", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.state.wordInput = "弹无";
    s.requestClearAll();
    expect(s.state.clearConfirmOpen).toBe(true);
    s.confirmClearAll();
    expect(s.state.wordInput).toBe("");
  });

  it("确认框文案", () => {
    expect(DeduceSession.clearConfirmTitle).toBe("清空全部条件？");
    expect(DeduceSession.clearConfirmBody).toBe("已录入的猜测与标记将全部清除，此操作不可撤销。");
    expect(DeduceSession.clearConfirmActionTitle).toBe("确认清空");
    expect(DeduceSession.clearCancelTitle).toBe("取消");
  });
});

describe("DeduceSession · 以已记录的词重新开始", () => {
  it("需要确认，确认前什么都不动", async () => {
    const s = sessionWithGuesses(["弹无虚发", "百发百中", "一心一意"]);
    await s.waitForFilter();
    const guesses = snap(s.state.guesses);
    const words = itemWords(s);

    s.requestRestart(1);
    expect(s.state.restartRequest).toEqual({ index: 1, word: "百发百中", guessCount: 3 });
    expect(s.state.guesses, "确认之前什么都不清").toEqual(guesses);
    expect(s.state.draft).toBeNull();
    expect(itemWords(s)).toEqual(words);

    s.cancelRestart();
    expect(s.state.restartRequest).toBeNull();
    expect(s.state.guesses).toEqual(guesses);
    expect(s.state.draft).toBeNull();
  });

  it("确认后清空一切并以该词（空标记）重新开始", async () => {
    const s = sessionWithGuesses(["弹无虚发", "百发百中", "一心一意"]);
    s.toggleHistoryExpanded(1);
    s.loadWord("无中生有"); // 标记台上有一个带标记、尚未确认的词
    s.presentMark(draft, 0, "char");
    s.state.showDetailPanel = true;
    await s.waitForFilter();
    expect(s.state.guesses.length).toBe(3);

    s.requestRestart(1);
    expect(s.confirmRestart(), "确认后返回被选中的那个词，交给视图复制").toBe("百发百中");

    expect(s.state.restartRequest).toBeNull();
    expect(s.state.guesses, "已记录的猜测全部清掉").toEqual([]);
    expect(s.isHistoryExpanded(1), "展开状态跟着清掉").toBe(false);
    expect(s.state.showDetailPanel).toBe(false);

    const d = s.state.draft!;
    expect(d.word).toBe("百发百中");
    expect(d.pinyin).toBe("bǎi fā bǎi zhòng");
    expect(d.chars.map((c) => c.c)).toEqual(["百", "发", "百", "中"]);
    expect(d.marks, "标记全部留空，不沿用旧标记").toEqual(DeduceEngine.createEmptyMarks(4));
    expect(d.editIndex, "是新的一条，不是修改旧记录").toBeNull();
    expect(s.state.wordInput).toBe("百发百中");
    expect(s.state.showPinyinBar).toBe(true);
    expect(s.state.pinyinInput).toBe("bai3 fa1 bai3 zhong4");
    expect(s.state.draftBaseline).toBe("bai3 fa1 bai3 zhong4");
    expect(s.pinyinDirty).toBe(false);
    expect(s.commitButtonTitle).toBe("确认本条并筛选");
    expect(s.state.message).toEqual({ text: "已清空，以「百发百中」重新开始并已复制，请重新标记", kind: "ok" });

    // 没有任何带标记的猜测：筛选结果立即清空
    await s.waitForFilter();
    expect(s.state.items).toEqual([]);
    expect(s.state.total).toBe(0);
    expect(s.resultsMeta).toBe("");
  });

  it("重新开始丢掉旧一轮的筛选结果", async () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("百发百中");
    s.toggleMark(draft, 1, "char"); // 第 2 字「发」位置对 → 候选「一发千钧」
    s.commitGuess();
    await s.waitForFilter();
    expect(itemWords(s), "前提：重新开始之前有筛选结果").toEqual(["一发千钧"]);

    expect(s.restart(0)).toBe(true);
    await s.waitForFilter();
    expect(s.state.items, "新一轮还没有任何标记，旧候选不能留着").toEqual([]);
    expect(s.state.total).toBe(0);
  });

  it("新一轮从单条猜测重新累计", async () => {
    const s = sessionWithGuesses(["弹无虚发", "百发百中", "一心一意"]);
    expect(s.restart(0)).toBe(true);

    s.presentMark(draft, 1, "char");
    expect(s.commitGuess()).toBe(true);
    expect(s.state.guesses.map((g) => g.word), "新一轮从这一条重新累计").toEqual(["弹无虚发"]);
    expect(s.state.guesses[0].marks[1].char).toBe("present");
    expect(s.state.guesses[0].marks[0].char, "旧一轮的标记没有带过来").toBe("absent");

    // 新一轮的筛选只看这一条
    await s.waitForFilter();
    const engine = DeduceEngine.filter({
      table: s.lexicon.table,
      guesses: s.state.guesses,
      polyMap: s.lexicon.polyMap,
      limit: 200,
    });
    expect(s.state.total).toBe(engine?.total);
    expect(itemWords(s)).toEqual(engine?.items.map((i) => i.word));
  });

  it("沿用已记录的读音，即使与词库不同", () => {
    const s = sessionWithGuesses(["弹无虚发"]);
    s.editHistorySyllable(0, 0, "tan2"); // 词库里是 dan4，这里逐字改成了 tan2
    s.cancelPersistPinyin();
    expect(s.state.guesses[0].chars[0].py).toBe("tan");

    expect(s.restart(0)).toBe(true);
    const d = s.state.draft!;
    expect(d.chars[0].py, "沿用已记录的读音，不退回词库默认读音").toBe("tan");
    expect(d.pinyin).toBe("tán wú xū fā");
    expect(s.state.pinyinInput).toBe("tan2 wu2 xu1 fa1");
    expect(s.pinyinDirty, "读音基线同步，不会冒出多余的「应用读音」").toBe(false);
  });

  it("词库没有的词也能重新开始", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.state.wordInput = "天马行空";
    s.loadWord();
    s.state.pinyinInput = "tian1 ma3 xing2 kong1";
    s.applyPinyin();
    s.cancelPersistPinyin();
    s.toggleMark(draft, 0, "char");
    expect(s.commitGuess()).toBe(true);

    // 若按「重新输入」走词库，这个词会变成「未找到」；沿用已记录读音则可以直接重新标记
    expect(s.restart(0)).toBe(true);
    const d = s.state.draft!;
    expect(d.word).toBe("天马行空");
    expect(d.marks).toEqual(DeduceEngine.createEmptyMarks(4));
    expect(s.state.pinyinInput).toBe("tian1 ma3 xing2 kong1");
    expect(s.canCommit).toBe(true);
  });

  it("多音字开关与修改状态", () => {
    const s = sessionWithGuesses(["弹无虚发", "百发百中"]);
    s.includePolyphones = true;
    s.editGuess(1); // 正在修改第 2 条
    expect(s.state.draft?.editIndex).toBe(1);

    expect(s.restart(0)).toBe(true);
    expect(s.state.includePolyphones, "多音字开关是用户设置，不属于这一轮").toBe(true);
    expect(s.state.draft?.editIndex, "之前的修改状态作废，下标不会指向已经不存在的记录").toBeNull();
    expect(s.state.draft?.word).toBe("弹无虚发");
  });

  it("下标越界什么都不做", () => {
    const s = sessionWithGuesses(["弹无虚发"]);
    const guesses = snap(s.state.guesses);
    s.requestRestart(3);
    s.requestRestart(-1);
    expect(s.state.restartRequest).toBeNull();
    expect(s.restart(3)).toBe(false);
    expect(s.restart(-1)).toBe(false);
    expect(s.state.guesses).toEqual(guesses);
    expect(s.state.draft).toBeNull();

    expect(s.confirmRestart(), "没有待确认的请求：什么都没清，也没有要复制的词").toBeNull();
    expect(s.state.guesses).toEqual(guesses);
  });

  it("下标与词面对不上的请求被忽略", () => {
    const s = sessionWithGuesses(["弹无虚发", "百发百中", "一心一意"]);
    s.requestRestart(1); // 百发百中
    s.removeGuess(0); // 下标整体前移：现在 1 号是「一心一意」
    expect(s.confirmRestart(), "词面对不上：什么都没清，不复制").toBeNull();

    expect(s.state.restartRequest).toBeNull();
    expect(s.state.guesses.map((g) => g.word), "词面对不上就什么都不清").toEqual(["百发百中", "一心一意"]);
    expect(s.state.draft).toBeNull();
  });

  it("复制失败改写提示，但不影响已完成的重新开始", () => {
    const s = sessionWithGuesses(["弹无虚发", "百发百中"]);
    s.requestRestart(1);
    expect(s.confirmRestart()).toBe("百发百中");
    s.reportRestartCopyFailed("百发百中");
    expect(s.state.message).toEqual({ text: "已清空，以「百发百中」重新开始，复制失败", kind: "warn" });
    expect(s.state.draft?.word, "复制失败不影响已经完成的重新开始").toBe("百发百中");
  });

  it("确认框文案", () => {
    expect(DeduceSession.restartConfirmTitle).toBe("清空后重新开始？");
    expect(DeduceSession.restartConfirmActionTitle).toBe("清空并重新开始");
    expect(DeduceSession.restartConfirmBody({ index: 2, word: "弹无虚发", guessCount: 5 })).toBe(
      "将清除全部 5 条已记录猜测、标记台上正在编辑的内容与筛选结果，并以「弹无虚发」作为第一个词重新标记，此操作不可撤销。",
    );
  });
});
