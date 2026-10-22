// 筛选流水线（去抖 / 取消 / 忙碌 / 失败）、多音字开关、词库替换、结果文案、候选选中与复制全部。
// 对应 Swift `DeduceSessionFilterTests.swift`。

import { describe, expect, it } from "vitest";
import { DeduceEngine } from "../../src/core/engine/engine";
import { buildChars } from "../../src/core/pinyin/pinyin";
import { createGuess } from "../../src/core/model/types";
import { DeduceSession, defaultDeduceFilterRunner } from "../../src/core/session/session";
import { draftTarget as draft, type MarkAttr } from "../../src/core/session/types";
import {
  DeduceSessionRunnerProbe,
  deduceSessionLexicon,
  itemWords,
  makeDeduceSession,
  settledWords,
} from "./support/sessionSupport";

/** 与会话同参数直接跑引擎，作为期望值。 */
function engineResult(s: DeduceSession): { words: string[]; total: number } {
  const r = DeduceEngine.filter({
    table: s.lexicon.table,
    guesses: s.activeGuesses,
    polyMap: s.lexicon.polyMap,
    limit: DeduceSession.resultLimit,
    includePolyphones: s.includePolyphones,
  });
  return { words: r?.items.map((i) => i.word) ?? [], total: r?.total ?? 0 };
}

/**
 * 弹药 / 弹丸 / 弹琴 / 但药：用来观察多音字开关。弹 默认 dan4，备选 tan2。
 * 猜「但药」(dan4 yao4) 且只标第一位的声韵调为对：词库读音只命中「弹丸」；开启多音字后「弹琴」(tan2) 也能以 dan4 读音命中。
 */
const polyWords: readonly (readonly [string, string])[] = [
  ["弹药", "dan4 yao4"],
  ["弹丸", "dan4 wan2"],
  ["弹琴", "tan2 qin2"],
  ["但药", "dan4 yao4"],
];

/**
 * 第一位的声 / 韵 / 调都人选为「对」（字不标）。
 * 注意：字标为对时，带出的声韵调是「自动」的，且字已钉死位置，不再钉读音（为了兼容多音字）；
 * 只有字不是对的时候，人选的声韵调才会把读音钉死，所以多音字开关的差异要这样观察。
 */
function markFirstReadingHit(s: DeduceSession): void {
  for (const attr of ["sm", "ym", "tone"] as MarkAttr[]) s.toggleMark(draft, 0, attr);
}

/** 造 n 条互不相同的四字词（读音全是 yi4），用来测 200 条显示上限与「复制全部」。 */
function bulkWords(n: number): (readonly [string, string])[] {
  return Array.from({ length: n }, (_, i) => {
    const base = 0x4e00 + i * 4;
    return [String.fromCodePoint(base, base + 1, base + 2, base + 3), "yi4 yi4 yi4 yi4"] as const;
  });
}

describe("DeduceSession · 去抖 / 取消", () => {
  it("没有猜测时从不筛选", async () => {
    const probe = new DeduceSessionRunnerProbe();
    const s = makeDeduceSession(deduceSessionLexicon(), { runner: probe.runner });
    await s.waitForFilter();
    s.loadWord("弹无虚发"); // 草稿没有标记 → 不参与筛选
    await s.waitForFilter();
    expect(probe.callCount).toBe(0);
    expect(s.state.items).toEqual([]);
    expect(s.state.total).toBe(0);
    expect(s.state.busy).toBe(false);
    expect(s.state.error).toBeNull();
  });

  it("快速连续变更合并成一次筛选，用最后的状态", async () => {
    const probe = new DeduceSessionRunnerProbe();
    const s = makeDeduceSession(deduceSessionLexicon(), {
      debounceMs: DeduceSession.defaultFilterDebounceMs,
      runner: probe.runner,
    });
    // 同一个回合里连续改很多次：只应有最后一次状态真正去筛
    s.loadWord("弹无虚发");
    s.toggleMark(draft, 0, "char");
    s.toggleMark(draft, 1, "char");
    s.presentMark(draft, 2, "char");
    s.toggleMark(draft, 1, "char"); // 1 号位 对 → 无
    s.includePolyphones = true;
    s.includePolyphones = false;
    expect(probe.callCount, "去抖：状态变化当下不会同步开跑").toBe(0);
    await s.waitForFilter();

    expect(probe.callCount, "快速连续变更只产出一次筛选").toBe(1);
    const expected = engineResult(s);
    expect(itemWords(s)).toEqual(expected.words);
    expect(s.state.total).toBe(expected.total);
    expect(s.state.busy).toBe(false);
  });

  it("新变更取消正在运行的筛选，只发布最后一次的结果", async () => {
    const probe = new DeduceSessionRunnerProbe();
    probe.setBehavior({ kind: "blockUntilCancelled" }, 0);
    const s = makeDeduceSession(deduceSessionLexicon(), { runner: probe.runner });

    s.loadWord("弹无虚发");
    s.toggleMark(draft, 0, "char");
    await probe.started(0); // 第一次筛选已开跑并被阻塞
    expect(s.state.busy).toBe(true);

    s.toggleMark(draft, 3, "char"); // 新变更 → 取消旧的
    await s.waitForFilter();
    await probe.finished(0); // 旧请求确实退出了

    expect(probe.callCount).toBe(2);
    expect(probe.sawCancel[0], "旧请求收到取消信号").toBe(true);
    const expected = engineResult(s);
    expect(itemWords(s), "发布的是第二次的结果").toEqual(expected.words);
    expect(s.state.total).toBe(expected.total);
    expect(s.state.busy).toBe(false);
  });

  it("默认执行体响应取消", async () => {
    const lex = deduceSessionLexicon();
    const guess = createGuess({
      word: "弹无虚发",
      pinyin: "dan4 wu2 xu1 fa1",
      chars: buildChars("弹无虚发", "dan4 wu2 xu1 fa1")!,
      marks: DeduceEngine.createEmptyMarks(4),
    });
    const request = { table: lex.table, guesses: [guess], polyMap: lex.polyMap, limit: 200, includePolyphones: false };
    // 已取消 → 引擎尽快返回 null；未取消 → 正常出结果
    expect(await defaultDeduceFilterRunner(request, () => true)).toBeNull();
    expect(await defaultDeduceFilterRunner(request, () => false)).not.toBeNull();
  });

  it("忙碌标志与统计文案的省略号", async () => {
    const probe = new DeduceSessionRunnerProbe();
    probe.setBehavior({ kind: "blockUntilReleased" }, 0);
    const s = makeDeduceSession(deduceSessionLexicon(), { runner: probe.runner });

    s.loadWord("弹无虚发");
    s.toggleMark(draft, 0, "char");
    await probe.started(0);
    expect(s.state.busy).toBe(true);
    expect(s.resultsMeta.endsWith("…"), s.resultsMeta).toBe(true);

    probe.release();
    await s.waitForFilter();
    expect(s.state.busy).toBe(false);
    expect(s.resultsMeta.endsWith("…"), s.resultsMeta).toBe(false);
  });

  it("有效猜测没有实际变化就不重新筛选", async () => {
    const probe = new DeduceSessionRunnerProbe();
    const s = makeDeduceSession(deduceSessionLexicon(), { runner: probe.runner });
    s.loadWord("弹无虚发");
    s.toggleMark(draft, 0, "char");
    await s.waitForFilter();
    expect(probe.callCount).toBe(1);

    s.state.showDetailPanel = true;
    s.state.wordInput = "弹无虚发";
    s.loadWord(); // 同一个词，标记保持
    s.toggleHistoryExpanded(0);
    s.requestClearAll();
    s.cancelClearAll();
    s.includePolyphones = false; // 没有变化
    await s.waitForFilter();
    expect(probe.callCount).toBe(1);

    // 真正改了标记才会再筛
    s.toggleMark(draft, 1, "char");
    await s.waitForFilter();
    expect(probe.callCount).toBe(2);
  });

  it("草稿预览在确认前就参与筛选", async () => {
    const probe = new DeduceSessionRunnerProbe();
    const s = makeDeduceSession(deduceSessionLexicon(), { runner: probe.runner });
    s.loadWord("弹无虚发");
    s.toggleMark(draft, 0, "char");
    await s.waitForFilter();
    expect(probe.calls[probe.calls.length - 1]).toEqual(["弹无虚发"]);
    expect(s.state.guesses).toEqual([]);
    expect(s.activeGuesses.length).toBe(1);
  });

  it("执行体失败会显示错误，下一次成功后清除", async () => {
    const probe = new DeduceSessionRunnerProbe();
    probe.setBehavior({ kind: "fail", message: "引擎炸了" }, 0);
    const s = makeDeduceSession(deduceSessionLexicon(), { runner: probe.runner });
    s.loadWord("弹无虚发");
    s.toggleMark(draft, 0, "char");
    await s.waitForFilter();

    expect(s.state.error).toBe("引擎炸了");
    expect(s.state.items).toEqual([]);
    expect(s.state.total).toBe(0);
    expect(s.state.busy).toBe(false);
    expect(s.resultsMeta).toBe("筛选失败：引擎炸了");

    s.toggleMark(draft, 1, "char");
    await s.waitForFilter();
    expect(s.state.error).toBeNull();
    expect(s.resultsMeta.startsWith("合并 1 条猜测后，共 "), s.resultsMeta).toBe(true);
  });

  it("dispose 之后不再响应状态变化", async () => {
    const probe = new DeduceSessionRunnerProbe();
    const s = makeDeduceSession(deduceSessionLexicon(), { runner: probe.runner });
    s.dispose();
    s.state.includePolyphones = true; // watcher 已停
    await s.waitForFilter();
    expect(probe.callCount).toBe(0);
  });
});

describe("DeduceSession · 多音字开关 / 词库替换", () => {
  it("includePolyphones 变化重新筛选", async () => {
    const probe = new DeduceSessionRunnerProbe();
    const s = makeDeduceSession(deduceSessionLexicon(polyWords), { runner: probe.runner });
    s.loadWord("但药");
    markFirstReadingHit(s); // 第一位读 dan4
    let words = await settledWords(s);
    expect(words, "默认只按词库读音：弹琴(tan2)不算").toEqual(["弹丸"]);
    expect(probe.callCount).toBe(1);

    s.includePolyphones = true;
    words = await settledWords(s);
    expect(probe.callCount, "开关变化重新筛选").toBe(2);
    expect(words, "开启后多音字始终参与").toEqual(["弹丸", "弹琴"]);
    expect(s.state.total).toBe(2);
    expect(s.resultsMeta.includes("（含多音字）"), s.resultsMeta).toBe(true);

    s.includePolyphones = false;
    words = await settledWords(s);
    expect(probe.callCount).toBe(3);
    expect(words).toEqual(["弹丸"]);
    expect(s.resultsMeta.includes("多音字")).toBe(false);
  });

  it("视图直接改 state.includePolyphones（v-model）同样触发重新筛选", async () => {
    const probe = new DeduceSessionRunnerProbe();
    const s = makeDeduceSession(deduceSessionLexicon(polyWords), { runner: probe.runner });
    s.loadWord("但药");
    markFirstReadingHit(s);
    await s.waitForFilter();
    s.state.includePolyphones = true;
    expect(await settledWords(s)).toEqual(["弹丸", "弹琴"]);
    expect(probe.callCount).toBe(2);
  });

  it("替换词库用新表重新筛选，已记录猜测不受影响", async () => {
    const probe = new DeduceSessionRunnerProbe();
    const s = makeDeduceSession(deduceSessionLexicon(polyWords), { runner: probe.runner });
    s.loadWord("但药");
    markFirstReadingHit(s);
    const before = await settledWords(s);
    expect(before).toEqual(["弹丸"]);
    const guesses = JSON.stringify(s.state.guesses);
    const draftJson = JSON.stringify(s.state.draft);

    s.lexicon = deduceSessionLexicon([...polyWords, ["弹壳", "dan4 ke2"]]);
    const after = await settledWords(s);
    expect(probe.callCount).toBe(2);
    expect(after).toEqual(["弹丸", "弹壳"]);
    expect(JSON.stringify(s.state.guesses), "已记录猜测不受词库替换影响").toBe(guesses);
    expect(JSON.stringify(s.state.draft)).toBe(draftJson);
  });

  it("已记录猜测保留自己的读音，即使词库读音变了", async () => {
    const s = makeDeduceSession(deduceSessionLexicon(polyWords));
    s.loadWord("弹药");
    s.setMark(0, "char", "hit");
    s.commitGuess();
    const chars = JSON.stringify(s.state.guesses[0].chars);
    s.lexicon = deduceSessionLexicon([
      ["弹药", "tan2 yao4"],
      ["弹丸", "dan4 wan2"],
    ]);
    await s.waitForFilter();
    expect(JSON.stringify(s.state.guesses[0].chars)).toBe(chars);
    expect(s.state.guesses[0].chars[0].tone).toBe(4);
  });
});

describe("DeduceSession · 结果文案", () => {
  it("统计文案", async () => {
    const s = makeDeduceSession(deduceSessionLexicon(polyWords));
    expect(s.resultsMeta).toBe("");
    expect(s.resultsEmptyText).toBe("添加猜测并标记后，这里显示符合条件的成语");
    expect(s.resultsMoreText).toBeNull();

    s.loadWord("但药");
    expect(s.resultsMeta, "草稿还没标记，不算有效猜测").toBe("");
    markFirstReadingHit(s);
    await s.waitForFilter();
    expect(s.resultsMeta).toBe("合并 1 条猜测后，共 1 条候选（含当前编辑预览）");

    s.includePolyphones = true;
    await s.waitForFilter();
    expect(s.resultsMeta).toBe("合并 1 条猜测后，共 2 条候选（含当前编辑预览）（含多音字）");

    s.commitGuess();
    await s.waitForFilter();
    expect(s.resultsMeta).toBe("合并 1 条猜测后，共 2 条候选（含多音字）");

    // 再加一条：条数随有效猜测数变化
    s.loadWord("弹丸");
    s.presentMark(draft, 1, "char");
    await s.waitForFilter();
    expect(s.resultsMeta.startsWith("合并 2 条猜测后，共 "), s.resultsMeta).toBe(true);
    expect(s.resultsMeta.includes("（含当前编辑预览）")).toBe(true);
  });

  it("没有匹配时的占位文案", async () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    // 矛盾的标记：第一字「百」对，同位的声母却标成无
    s.loadWord("百发百中");
    s.setMark(0, "char", "hit");
    s.setMark(0, "sm", "absent");
    await s.waitForFilter();
    expect(s.state.total).toBe(0);
    expect(s.state.items).toEqual([]);
    expect(s.resultsEmptyText).toBe("无匹配成语，请检查标记是否矛盾");
    expect(s.resultsMeta).toBe("合并 1 条猜测后，共 0 条候选（含当前编辑预览）");
  });

  it("200 条显示上限与「另有 N 条」", async () => {
    const s = makeDeduceSession(deduceSessionLexicon(bulkWords(250), {}, "{}"));
    s.state.wordInput = "天马行空";
    s.state.pinyinInput = "tian1 ma3 xing2 kong1";
    s.applyPinyin();
    s.commitGuess(); // 全部未选 = 全部「无」；与测试词库毫无交集 → 250 条全中
    await s.waitForFilter();

    expect(s.state.total).toBe(250);
    expect(s.state.items.length).toBe(DeduceSession.resultLimit);
    expect(DeduceSession.resultLimit).toBe(200);
    expect(s.hiddenResultCount).toBe(50);
    expect(s.resultsMoreText).toBe("… 另有 50 条未显示");
    expect(s.resultsMeta).toBe("合并 1 条猜测后，共 250 条候选");
  });
});

describe("DeduceSession · 候选", () => {
  it("候选带展示拼音与读音", async () => {
    const s = makeDeduceSession(deduceSessionLexicon(polyWords));
    s.loadWord("弹药");
    s.setMark(0, "char", "hit");
    await s.waitForFilter();
    const item = s.state.items[0];
    expect(item.word).toBe("弹丸");
    expect(item.pinyin).toBe("dàn wán");
    expect(item.chars.map((c) => c.c)).toEqual(["弹", "丸"]);
    expect(item.chars.map((c) => c.tone)).toEqual([4, 2]);
    expect(s.lexicon.table.word(item.row)).toBe("弹丸");
  });

  it("展示拼音：轻声音节在多音表里能找到同音节声调就补上", async () => {
    // 词库里写成轻声(无调)的「发」，多音表里同音节有一声 → 展示补上调号
    const lex = deduceSessionLexicon([
      ["弹药", "dan4 yao4"],
      ["弹发", "dan4 fa"],
    ]);
    const s = makeDeduceSession(lex);
    s.loadWord("弹药");
    s.setMark(0, "char", "hit");
    await s.waitForFilter();
    const item = s.state.items.find((i) => i.word === "弹发")!;
    expect(item.chars[1].tone).toBe(5);
    expect(item.pinyin).toBe("dàn fā");
  });

  it("选中候选：载入标记台，返回要复制的词面", async () => {
    const s = makeDeduceSession(deduceSessionLexicon(polyWords));
    s.loadWord("弹药");
    s.setMark(0, "char", "hit");
    await s.waitForFilter();
    const item = s.state.items[0];
    expect(s.state.stageFlashTick).toBe(0);

    const copied = s.selectCandidate(item);
    expect(copied).toBe("弹丸");
    expect(s.state.draft?.word).toBe("弹丸");
    expect(s.selectedWord).toBe("弹丸");
    expect(s.state.wordInput).toBe("弹丸");
    expect(s.state.showPinyinBar).toBe(true);
    expect(s.state.pinyinInput).toBe("dan4 wan2");
    expect(s.state.draft?.marks, "新词载入空标记").toEqual(DeduceEngine.createEmptyMarks(2));
    expect(s.state.message).toEqual({ text: "已选中并复制「弹丸」", kind: "ok" });
    expect(s.state.stageFlashTick).toBe(1);
    // 原来带标记的草稿被先提交
    expect(s.state.guesses.map((g) => g.word)).toEqual(["弹药"]);

    s.reportSelectionCopyFailed("弹丸");
    expect(s.state.message).toEqual({ text: "已选中「弹丸」，复制失败", kind: "warn" });
  });

  it("未标记的草稿直接被替换", () => {
    const s = makeDeduceSession(deduceSessionLexicon(polyWords));
    s.loadWord("弹药");
    expect(s.selectCandidate("弹丸")).toBe("弹丸");
    expect(s.state.guesses).toEqual([]);
    expect(s.state.draft?.word).toBe("弹丸");
  });

  it("词库里没有的候选返回 null", () => {
    const s = makeDeduceSession(deduceSessionLexicon(polyWords));
    expect(s.selectCandidate("天马行空")).toBeNull();
    expect(s.state.draft).toBeNull();
    expect(s.state.stageFlashTick).toBe(0);
  });

  it("已记录的词进入修改模式", () => {
    const s = makeDeduceSession(deduceSessionLexicon(polyWords));
    s.loadWord("弹药");
    s.setMark(0, "char", "hit");
    s.commitGuess();
    expect(s.selectCandidate("弹药")).toBe("弹药");
    expect(s.state.draft?.editIndex).toBe(0);
  });
});

describe("DeduceSession · 复制全部", () => {
  it("返回全部匹配，不受 200 条显示上限限制", async () => {
    const s = makeDeduceSession(deduceSessionLexicon(bulkWords(250), {}, "{}"));
    s.state.wordInput = "天马行空";
    s.state.pinyinInput = "tian1 ma3 xing2 kong1";
    s.applyPinyin();
    s.commitGuess();
    await s.waitForFilter();
    expect(s.state.items.length).toBe(200);

    const words = await s.copyAllCandidates();
    expect(words.length).toBe(250);
    expect(words, "词库行序").toEqual(bulkWords(250).map((w) => w[0]));
    expect(s.state.message).toEqual({ text: "已复制 250 条待选成语", kind: "ok" });

    s.reportCopyFailed();
    expect(s.state.message).toEqual({ text: "复制失败", kind: "err" });
  });

  it("没有可复制的内容", async () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    let words = await s.copyAllCandidates();
    expect(words).toEqual([]);
    expect(s.state.message).toEqual({ text: "暂无待选成语可复制", kind: "warn" });

    // 有猜测但没有候选
    s.loadWord("百发百中");
    s.setMark(0, "char", "hit");
    s.setMark(0, "sm", "absent");
    await s.waitForFilter();
    expect(s.state.total).toBe(0);
    s.state.message = null;
    words = await s.copyAllCandidates();
    expect(words).toEqual([]);
    expect(s.state.message).toEqual({ text: "暂无待选成语可复制", kind: "warn" });
  });

  it("遵循多音字开关", async () => {
    const s = makeDeduceSession(deduceSessionLexicon(polyWords));
    s.loadWord("但药");
    markFirstReadingHit(s);
    await s.waitForFilter();
    let words = await s.copyAllCandidates();
    expect(words).toEqual(["弹丸"]);
    s.includePolyphones = true;
    await s.waitForFilter();
    words = await s.copyAllCandidates();
    expect(words).toEqual(["弹丸", "弹琴"]);
  });
});

describe("DeduceSession · 释义", () => {
  it("按需读取，词库替换后按词面重新查行", async () => {
    const lex = deduceSessionLexicon(polyWords, { 弹丸: "指弹子", 弹琴: "弹奏琴" });
    const s = makeDeduceSession(lex);
    s.loadWord("弹药");
    s.setMark(0, "char", "hit");
    await s.waitForFilter();
    const item = s.state.items[0];
    expect(s.explanationForRow(item.row)).toBe("指弹子");
    expect(s.explanation(item)).toBe("指弹子");
    expect(s.explanationForRow(-1)).toBe("");
    expect(s.explanationForRow(99)).toBe("");

    // 词库换了、行号错位：按词面重新查
    s.lexicon = deduceSessionLexicon(
      [
        ["弹琴", "tan2 qin2"],
        ["弹丸", "dan4 wan2"],
        ["弹药", "dan4 yao4"],
      ],
      { 弹丸: "新释义" },
    );
    expect(s.explanation(item)).toBe("新释义");
  });
});
