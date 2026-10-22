// 加载词、拼音栏、逐字读音编辑、应用读音与写库确认。对应 Swift `DeduceSessionDraftTests.swift`。

import { describe, expect, it } from "vitest";
import { DeduceEngine } from "../../src/core/engine/engine";
import { formatReadingDigit, readingKey } from "../../src/core/pinyin/polyphone";
import {
  persistDialogCancelTitle,
  persistDialogConfirmTitle,
  persistDialogPrompt,
  persistDialogTitle,
  type PersistDialog,
} from "../../src/core/session/types";
import {
  DeduceSessionPersistProbe,
  deduceSessionLexicon,
  deduceSessionWords,
  makeDeduceSession,
  settledWords,
  snap,
} from "./support/sessionSupport";

describe("DeduceSession · 加载词", () => {
  it("已收录的词：载入词库读音", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.state.wordInput = "弹无虚发";
    s.loadWord();

    const d = s.state.draft;
    expect(d).not.toBeNull();
    expect(d?.word).toBe("弹无虚发");
    expect(d?.pinyin).toBe("dàn wú xū fā");
    expect(d?.chars.map((c) => c.c)).toEqual(["弹", "无", "虚", "发"]);
    expect(d?.marks).toEqual(DeduceEngine.createEmptyMarks(4));
    expect(d?.editIndex).toBeNull();
    expect(s.state.showPinyinBar).toBe(true);
    expect(s.state.pinyinInput).toBe("dan4 wu2 xu1 fa1");
    expect(s.state.draftBaseline).toBe("dan4 wu2 xu1 fa1");
    expect(s.pinyinDirty).toBe(false);
    expect(s.hasSelection).toBe(true);
    expect(s.state.message).toEqual({ text: "已加载词库读音，如有误可直接改单字读音", kind: "warn" });
    expect(s.state.persistDialog).toBeNull();
  });

  it("去掉全部空白（含全角空格）", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.state.wordInput = "  弹无 虚发\u3000";
    s.loadWord();
    expect(s.state.wordInput).toBe("弹无虚发");
    expect(s.state.draft?.word).toBe("弹无虚发");
  });

  it("wordOverride 优先于输入框", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.state.wordInput = "百发百中";
    s.loadWord("一心一意");
    expect(s.state.draft?.word).toBe("一心一意");
    expect(s.state.wordInput).toBe("一心一意");
  });

  it("空输入报错", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.state.wordInput = "  ";
    s.loadWord();
    expect(s.state.draft).toBeNull();
    expect(s.state.message).toEqual({ text: "请输入成语", kind: "err" });
    expect(s.state.showPinyinBar).toBe(false);
  });

  it("未收录的词：显示拼音栏", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.state.wordInput = "天马行空";
    s.loadWord();

    expect(s.state.draft).toBeNull();
    expect(s.state.showPinyinBar).toBe(true);
    expect(s.state.pinyinInput).toBe("");
    expect(s.state.draftBaseline).toBe("");
    expect(s.state.message).toEqual({ text: "词库中未找到「天马行空」，请填写拼音", kind: "warn" });
    expect(s.hasSelection).toBe(true);
  });

  it("未收录的词：应用拼音生成草稿并询问是否新增", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.state.wordInput = "天马行空";
    s.loadWord();
    s.state.pinyinInput = "tian1 ma3 xing2 kong1";
    s.applyPinyin();

    const d = s.state.draft;
    expect(d?.word).toBe("天马行空");
    expect(d?.pinyin).toBe("tiān mǎ xíng kōng");
    expect(d?.chars.map((c) => c.tone)).toEqual([1, 3, 2, 1]);
    expect(d?.marks.length).toBe(4);
    expect(s.state.draftBaseline).toBe("tian1 ma3 xing2 kong1");
    expect(s.state.persistDialog).toEqual({
      mode: "add",
      word: "天马行空",
      pinyin: "tiān mǎ xíng kōng",
      digit: "tian1 ma3 xing2 kong1",
      oldDigit: null,
    });
    expect(s.state.message).toEqual({ text: "读音已改成 tian1 ma3 xing2 kong1，请确认是否写入词库", kind: "warn" });
  });

  it("标记台各部分的可见性标志", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    expect(s.isStageEmpty).toBe(true);
    expect(s.pinyinBarVisible).toBe(false);
    expect(s.detailPanelVisible).toBe(false);

    // 未收录：出现整段拼音栏
    s.loadWord("天马行空");
    expect(s.isStageEmpty).toBe(false);
    expect(s.pinyinBarVisible).toBe(true);

    // 已收录：直接展示标记台，拼音栏不出现；「详细」按钮才打开弹层
    s.loadWord("弹无虚发");
    expect(s.isStageEmpty).toBe(false);
    expect(s.pinyinBarVisible, "整段拼音输入框不出现在已加载词上").toBe(false);
    s.state.showDetailPanel = true;
    expect(s.detailPanelVisible).toBe(true);
    s.clearSelection();
    expect(s.detailPanelVisible).toBe(false);
    expect(s.isStageEmpty).toBe(true);
  });

  it("应用拼音的错误情形", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.applyPinyin();
    expect(s.state.message).toEqual({ text: "请先输入成语", kind: "err" });

    s.state.wordInput = "天马行空";
    s.state.pinyinInput = "tian1 ma3";
    s.applyPinyin();
    expect(s.state.draft).toBeNull();
    expect(s.state.message).toEqual({ text: "拼音音节数与字数不一致", kind: "err" });
    expect(s.state.persistDialog).toBeNull();
  });

  it("应用拼音保留已有草稿的标记与 editIndex", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.toggleMark({ kind: "draft" }, 0, "char");
    s.commitGuess();
    s.editGuess(0);
    const marksBefore = snap(s.state.draft?.marks);

    s.state.pinyinInput = "tan2 wu2 xu1 fa1";
    s.applyPinyin();
    const d = s.state.draft;
    expect(d?.editIndex).toBe(0);
    expect(d?.marks).toEqual(marksBefore);
    expect(d?.chars[0].py).toBe("tan");
    expect(d?.pinyin).toBe("tán wú xū fā");
    // 词库读音不同 → 询问更新
    expect(s.state.persistDialog?.mode).toBe("update");
  });

  it("再次加载同一个词保留标记", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.toggleMark({ kind: "draft" }, 1, "char");
    const before = snap(s.state.draft);
    s.state.wordInput = "弹无虚发";
    s.loadWord();
    expect(s.state.draft).toEqual(before);
    expect(s.state.showPinyinBar).toBe(true);
    expect(s.state.pinyinInput).toBe("dan4 wu2 xu1 fa1");
    expect(s.state.guesses).toEqual([]);
  });

  it("加载另一个词时先提交带标记的草稿", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.toggleMark({ kind: "draft" }, 0, "char");
    s.loadWord("百发百中");

    expect(s.state.guesses.map((g) => g.word)).toEqual(["弹无虚发"]);
    expect(s.state.draft?.word).toBe("百发百中");
    expect(s.state.wordInput).toBe("百发百中");
    // 提交时的标记已定稿：没有未选项
    expect(s.state.guesses[0].marks[0].char).toBe("hit");
    expect(s.state.guesses[0].marks[1].char).toBe("absent");
  });

  it("加载另一个词时丢弃未标记的草稿", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.loadWord("百发百中");
    expect(s.state.guesses).toEqual([]);
    expect(s.state.draft?.word).toBe("百发百中");
  });

  it("加载已记录的词进入修改模式", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.toggleMark({ kind: "draft" }, 0, "char");
    s.commitGuess();
    s.loadWord("弹无虚发");

    expect(s.state.draft?.editIndex).toBe(0);
    expect(s.state.draft?.marks).toEqual(s.state.guesses[0].marks);
    expect(s.commitButtonTitle).toBe("更新本条并筛选");
    expect(s.state.message?.kind).toBe("warn");
  });

  it("带标记的草稿提交失败时中止加载", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.toggleMark({ kind: "draft" }, 0, "char");
    s.state.pinyinInput = "dan4 wu2"; // 音节数不对
    s.loadWord("百发百中");

    expect(s.state.draft?.word).toBe("弹无虚发");
    expect(s.state.guesses).toEqual([]);
    expect(s.state.message).toEqual({ text: "拼音音节数与字数不一致，请先修正读音", kind: "err" });
  });

  it("词库里读音无效的词按未收录处理", () => {
    // 词库里有这个词但拼音音节数对不上 → 读音无效 → 当作未收录，让用户手填
    const lex = deduceSessionLexicon([...deduceSessionWords, ["坏拼音词", "only one"]]);
    const s = makeDeduceSession(lex);
    s.loadWord("坏拼音词");
    expect(s.state.draft).toBeNull();
    expect(s.state.showPinyinBar).toBe(true);
    expect(s.state.message?.kind).toBe("warn");
  });
});

// MARK: - 读音编辑 / 应用读音 / 写库

describe("DeduceSession · 读音编辑", () => {
  it("改单字读音：草稿变脏", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.editDraftSyllable(0, "tan2");

    const d = s.state.draft;
    expect(d?.chars[0]).toEqual({ c: "弹", py: "tan", sm: "t", ym: "an", tone: 2 });
    expect(d?.pinyin).toBe("tán wú xū fā");
    expect(s.state.pinyinInput).toBe("tan2 wu2 xu1 fa1");
    expect(s.pinyinDirty).toBe(true);
    expect(s.state.persistDialog, "改读音本身不弹写库，要点「应用读音」").toBeNull();
    expect(s.state.message).toEqual({ text: "第 1 字读音已改为 tan2，可点右下角「应用读音」写入词库", kind: "ok" });

    // 改回去 → 不再 dirty
    s.editDraftSyllable(0, "dàn");
    expect(s.pinyinDirty).toBe(false);
  });

  it("接受带调号写法，空白与越界被忽略", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.editDraftSyllable(2, " xián ");
    expect(s.state.draft?.chars[2].py).toBe("xian");
    expect(s.state.draft?.chars[2].tone).toBe(2);
    expect(s.state.draft?.chars[2].sm).toBe("x");
    expect(s.state.draft?.chars[2].ym).toBe("ian");

    const msg = snap(s.state.message);
    s.editDraftSyllable(2, "   ");
    expect(s.state.message, "空串不改任何东西也不提示").toEqual(msg);
    s.editDraftSyllable(9, "ma1");
    expect(s.state.message, "位置越界被忽略").toEqual(msg);
  });

  it("无法解析的输入被拒绝", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    const before = snap(s.state.draft);
    s.editDraftSyllable(0, "5");
    expect(s.state.draft).toEqual(before);
    expect(s.state.message).toEqual({ text: "无法解析读音，请使用如 jian4 / xián 格式", kind: "err" });
  });

  it("没有草稿时什么都不做", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.editDraftSyllable(0, "tan2");
    expect(s.state.draft).toBeNull();
    expect(s.state.message).toBeNull();
  });

  it("声调下拉", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.setDraftTone(3, 5);
    expect(s.state.draft?.chars[3].tone).toBe(5);
    expect(s.state.pinyinInput).toBe("dan4 wu2 xu1 fa5");
    expect(s.state.draft?.pinyin).toBe("dàn wú xū fa");
    expect(s.pinyinDirty).toBe(true);
    expect(s.state.message).toEqual({ text: "第 4 字声调已改为 轻，可点「应用读音」写入词库", kind: "ok" });

    s.setDraftTone(3, 9); // 非法声调被忽略
    expect(s.state.draft?.chars[3].tone).toBe(5);
  });

  it("多音字：可选读音与选择", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    const d = s.state.draft!;
    expect(s.isPolyphone(d.chars[0])).toBe(true);
    expect(s.isPolyphone(d.chars[1])).toBe(false);
    const readings = s.polyReadings(d.chars[0]);
    expect(readings.map(formatReadingDigit)).toEqual(["dan4", "tan2"]);
    expect(readingKey(readings[0])).toBe(readingKey(d.chars[0]));

    s.chooseDraftReading(0, readings[1]);
    expect(s.state.draft?.chars[0].py).toBe("tan");
    expect(s.state.draft?.chars[0].tone).toBe(2);
    expect(s.state.pinyinInput).toBe("tan2 wu2 xu1 fa1");
    expect(s.pinyinDirty).toBe(true);
    // 候选读音列表里"当前读音"随之变化（视图据此高亮）
    const after = s.polyReadings(s.state.draft!.chars[0]);
    expect(formatReadingDigit(after[0])).toBe("tan2");
  });

  it("应用读音：与词库不同则询问更新", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.editDraftSyllable(0, "tan2");
    s.applyDraftPinyin();

    expect(s.pinyinDirty, "应用后基线更新").toBe(false);
    expect(s.state.draftBaseline).toBe("tan2 wu2 xu1 fa1");
    expect(s.state.persistDialog).toEqual({
      mode: "update",
      word: "弹无虚发",
      pinyin: "tán wú xū fā",
      digit: "tan2 wu2 xu1 fa1",
      oldDigit: "dan4 wu2 xu1 fa1",
    });
    expect(s.state.message).toEqual({
      text: "读音已从 dan4 wu2 xu1 fa1 改为 tan2 wu2 xu1 fa1，请确认是否更新词库",
      kind: "warn",
    });
  });

  it("应用读音：与词库一致无需更新", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.editDraftSyllable(0, "tan2");
    s.editDraftSyllable(0, "dan4");
    s.applyDraftPinyin();
    expect(s.state.persistDialog).toBeNull();
    expect(s.state.message).toEqual({ text: "读音 dan4 wu2 xu1 fa1 与词库一致，无需更新", kind: "ok" });
  });

  it("应用读音：词库没有的词询问新增", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.state.wordInput = "天马行空";
    s.state.pinyinInput = "tian1 ma3 xing2 kong1";
    s.applyPinyin();
    s.state.persistDialog = null;
    s.editDraftSyllable(1, "ma1");
    expect(s.pinyinDirty).toBe(true);
    s.applyDraftPinyin();
    // （上面把 persistDialog 赋过 null，TS 会窄化类型；用断言绕开）
    const dialog = s.state.persistDialog as PersistDialog | null;
    expect(dialog?.mode).toBe("add");
    expect(dialog?.digit).toBe("tian1 ma1 xing2 kong1");
  });

  it("没有草稿时应用读音什么都不做", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.applyDraftPinyin();
    expect(s.state.persistDialog).toBeNull();
    expect(s.state.message).toBeNull();
  });

  it("已记录猜测的逐字读音编辑", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.toggleMark({ kind: "draft" }, 0, "char");
    s.commitGuess();

    s.editHistorySyllable(0, 0, "tan2");
    expect(s.state.guesses[0].chars[0].py).toBe("tan");
    expect(s.state.guesses[0].pinyin).toBe("tán wú xū fā");
    // 历史条目读音一改就问写库（桌面同）；此时提示文案被写库询问覆盖
    expect(s.state.persistDialog?.mode).toBe("update");
    expect(s.state.persistDialog?.word).toBe("弹无虚发");
    expect(s.state.draft).toBeNull();

    // 边界：下标越界、空串都不动
    const snapshot = snap(s.state.guesses);
    s.editHistorySyllable(5, 0, "tan2");
    s.editHistorySyllable(0, 0, "");
    expect(s.state.guesses).toEqual(snapshot);
  });

  it("改已记录猜测的读音时同步正在修改它的草稿", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.toggleMark({ kind: "draft" }, 0, "char");
    s.commitGuess();
    s.editGuess(0);
    expect(s.pinyinDirty).toBe(false);

    s.editHistorySyllable(0, 1, "wu3");
    expect(s.state.draft?.chars[1].tone).toBe(3);
    expect(s.state.draft?.pinyin).toBe(s.state.guesses[0].pinyin);
    expect(s.state.pinyinInput).toBe("dan4 wu3 xu1 fa1");
    // 桌面行为：基线不跟着变，所以会出现「应用读音」
    expect(s.pinyinDirty).toBe(true);
  });

  it("已记录猜测的多音字选择", () => {
    const s = makeDeduceSession(deduceSessionLexicon());
    s.loadWord("弹无虚发");
    s.toggleMark({ kind: "draft" }, 0, "char");
    s.commitGuess();
    const readings = s.polyReadings(s.state.guesses[0].chars[0]);
    s.chooseHistoryReading(0, 0, readings[readings.length - 1]);
    expect(formatReadingDigit(s.state.guesses[0].chars[0])).toBe("tan2");
  });
});

// MARK: - 写库确认

describe("DeduceSession · 写库确认", () => {
  it("取消写库：词库不动，草稿读音保留", async () => {
    const probe = new DeduceSessionPersistProbe();
    const s = makeDeduceSession(deduceSessionLexicon(), { persist: probe });
    s.loadWord("弹无虚发");
    s.editDraftSyllable(0, "tan2");
    s.applyDraftPinyin();
    expect(s.state.persistDialog).not.toBeNull();

    s.cancelPersistPinyin();
    expect(s.state.persistDialog).toBeNull();
    expect(s.state.message).toEqual({ text: "已仅更新当前展示，未改词库", kind: "warn" });
    expect(probe.requests).toEqual([]);
    // 草稿读音保留
    expect(s.state.draft?.chars[0].py).toBe("tan");

    // 没有对话框时确认是空操作
    await s.confirmPersistPinyin();
    expect(probe.requests).toEqual([]);
  });

  it("确认更新成功：换词库并重新筛选", async () => {
    const probe = new DeduceSessionPersistProbe();
    const s = makeDeduceSession(deduceSessionLexicon(), { persist: probe });
    s.loadWord("弹无虚发");
    s.setMark(0, "char", "hit"); // 第一字「弹」对（其余未选 = 无）
    const before = await settledWords(s);
    expect(before).not.toContain("弹炮铁磨");

    // 宿主写库后换上新词库：新词库里多了一个能通过上述约束的「弹炮铁磨」
    const newLex = deduceSessionLexicon([...deduceSessionWords, ["弹炮铁磨", "dan4 pao4 tie3 mo4"]]);
    probe.hook = () => {
      s.lexicon = newLex;
    };

    s.editDraftSyllable(3, "fa2");
    s.applyDraftPinyin();
    expect(s.state.persistDialog?.mode).toBe("update");

    await s.confirmPersistPinyin();
    expect(probe.requests).toEqual([{ word: "弹无虚发", pinyin: "dàn wú xū fá", mode: "update" }]);
    expect(s.state.persistDialog).toBeNull();
    expect(s.state.lexiconBusyText).toBeNull();
    expect(s.lexiconBusy).toBe(false);
    expect(s.state.message).toEqual({ text: "已更新词库「弹无虚发」读音为 dan4 wu2 xu1 fa2", kind: "ok" });

    // 词库被替换 → 重新筛选，候选里出现新词
    const after = await settledWords(s);
    expect(after).toContain("弹炮铁磨");
    expect(s.state.total).toBe(after.length);
    expect(s.state.draft?.chars[3].tone).toBe(2);
  });

  it("确认新增：写库期间有忙碌提示，成功文案与请求正确", async () => {
    const probe = new DeduceSessionPersistProbe();
    const s = makeDeduceSession(deduceSessionLexicon(), { persist: probe });
    s.state.wordInput = "天马行空";
    s.state.pinyinInput = "tian1 ma3 xing2 kong1";
    s.applyPinyin();

    // 写库期间能看到忙碌提示
    let sawBusy: string | null = null;
    probe.hook = () => {
      sawBusy = s.state.lexiconBusyText;
    };
    await s.confirmPersistPinyin();

    expect(sawBusy).toBe("正在写入词库…");
    expect(probe.requests).toEqual([{ word: "天马行空", pinyin: "tiān mǎ xíng kōng", mode: "add" }]);
    expect(s.state.message).toEqual({ text: "已新增「天马行空」到词库（tian1 ma3 xing2 kong1）", kind: "ok" });
    expect(s.state.lexiconBusyText).toBeNull();
  });

  it("确认更新：忙碌提示是「正在更新词库读音…」", async () => {
    const probe = new DeduceSessionPersistProbe();
    const s = makeDeduceSession(deduceSessionLexicon(), { persist: probe });
    s.loadWord("弹无虚发");
    s.editDraftSyllable(0, "tan2");
    s.applyDraftPinyin();
    let sawBusy: string | null = null;
    probe.hook = () => {
      sawBusy = s.state.lexiconBusyText;
    };
    await s.confirmPersistPinyin();
    expect(sawBusy).toBe("正在更新词库读音…");
  });

  it("写库失败：错误文案与默认文案", async () => {
    const probe = new DeduceSessionPersistProbe();
    probe.outcome = { ok: false, message: "磁盘已满" };
    const s = makeDeduceSession(deduceSessionLexicon(), { persist: probe });

    // 新增失败 → err
    s.state.wordInput = "天马行空";
    s.state.pinyinInput = "tian1 ma3 xing2 kong1";
    s.applyPinyin();
    await s.confirmPersistPinyin();
    expect(s.state.message).toEqual({ text: "磁盘已满", kind: "err" });
    expect(s.state.persistDialog).toBeNull();
    expect(s.state.lexiconBusyText).toBeNull();

    // 更新失败且没给文案 → 默认文案，warn（桌面：updated=false 为 warn）
    probe.outcome = { ok: false, message: "" };
    s.clearAll();
    s.loadWord("弹无虚发");
    s.editDraftSyllable(0, "tan2");
    s.applyDraftPinyin();
    await s.confirmPersistPinyin();
    expect(s.state.message).toEqual({ text: "更新词库失败", kind: "warn" });

    // 新增失败且没给文案
    s.clearAll();
    s.state.wordInput = "天马行空";
    s.state.pinyinInput = "tian1 ma3 xing2 kong1";
    s.applyPinyin();
    await s.confirmPersistPinyin();
    expect(s.state.message).toEqual({ text: "写入词库失败", kind: "err" });
  });

  it("persist 回调抛错也能收尾", async () => {
    const probe = new DeduceSessionPersistProbe();
    probe.hook = () => {
      throw new Error("网络断了");
    };
    const s = makeDeduceSession(deduceSessionLexicon(), { persist: probe });
    s.state.wordInput = "天马行空";
    s.state.pinyinInput = "tian1 ma3 xing2 kong1";
    s.applyPinyin();
    await s.confirmPersistPinyin();
    expect(s.state.message).toEqual({ text: "网络断了", kind: "err" });
    expect(s.state.lexiconBusyText).toBeNull();
  });

  it("换词库后同一读音无需再次更新", async () => {
    const probe = new DeduceSessionPersistProbe();
    const s = makeDeduceSession(deduceSessionLexicon(), { persist: probe });
    s.state.wordInput = "天马行空";
    s.state.pinyinInput = "tian1 ma3 xing2 kong1";
    s.applyPinyin();
    const newLex = deduceSessionLexicon([...deduceSessionWords, ["天马行空", "tian1 ma3 xing2 kong1"]]);
    probe.hook = () => {
      s.lexicon = newLex;
    };
    await s.confirmPersistPinyin();

    // 写入后词库里已有该词、读音一致
    s.editDraftSyllable(0, "tian1");
    s.applyDraftPinyin();
    expect(s.state.persistDialog).toBeNull();
    expect(s.state.message).toEqual({ text: "读音 tian1 ma3 xing2 kong1 与词库一致，无需更新", kind: "ok" });
  });

  it("对话框文案", () => {
    const add: PersistDialog = { mode: "add", word: "天马行空", pinyin: "p", digit: "tian1 ma3 xing2 kong1", oldDigit: null };
    expect(persistDialogTitle(add)).toBe("写入词库？");
    expect(persistDialogPrompt(add)).toBe("词库中没有「天马行空」。是否按读音 tian1 ma3 xing2 kong1 新增？");
    expect(persistDialogConfirmTitle(add)).toBe("写入词库");
    const upd: PersistDialog = { mode: "update", word: "弹无虚发", pinyin: "p", digit: "b", oldDigit: "a" };
    expect(persistDialogTitle(upd)).toBe("更新词库读音？");
    expect(persistDialogPrompt(upd)).toBe("是否将「弹无虚发」的读音从 a 更新为 b？");
    expect(persistDialogConfirmTitle(upd)).toBe("更新词库");
    expect(persistDialogCancelTitle).toBe("只改展示，不写库");
  });
});
