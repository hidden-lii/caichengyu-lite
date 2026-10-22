// 筛选引擎测试。对应 Swift `DeduceEngineTests.swift`。
// 前半部分逐条翻译桌面 src-tauri/src/deduce.rs 的测试模块（涉及 ü 的写法已按数据层改成 v），
// 之后是 deduce-empty-filter SKILL.md 里每个坑的回归用例、标记辅助函数、取消 / 分块 / 与参考实现的差分。

import { describe, expect, it } from "vitest";
import { DeduceEngine } from "../../src/core/engine/engine";
import { DeducePlan } from "../../src/core/engine/plan";
import { mergeDeduceConstraints } from "../../src/core/engine/constraints";
import { charsToMarkedPinyin } from "../../src/core/pinyin/pinyin";
import { syncPronunciationMarksForChar } from "../../src/core/pinyin/polyphone";
import { createPositionMarks, type CharData, type DeduceGuess, type PolyphoneMap } from "../../src/core/model/types";
import {
  DeduceReference,
  DeduceScenarioMaker,
  TestRNG,
  deduceGuess,
  deduceGuessAllHit,
  deduceGuessFromSlots,
  deduceMark,
  deduceMarkCombo,
  deducePolyMap,
  deduceSubTable,
  deduceTestTable,
  deduceWords,
  realLexicon,
} from "./support/engineSupport";

const noPoly: PolyphoneMap = new Map();
const mk = deduceMark;

const filter = (
  table: ReturnType<typeof deduceTestTable>,
  guesses: DeduceGuess[],
  polyMap: PolyphoneMap,
  opts: { limit?: number; includePolyphones?: boolean; isCancelled?: () => boolean } = {},
) => DeduceEngine.filter({ table, guesses, polyMap, ...opts });

// MARK: - 桌面 Rust 测试用例的翻译

describe("DeduceEngine · Rust 用例移植", () => {
  /** 用户调试串：钟灵毓秀 + 遭遇际会；毓/遇 声韵按「一组」combo 偏 */
  function userYuComboGuesses(): DeduceGuess[] {
    return [
      deduceGuess("钟灵毓秀", "zhong1 ling2 yu4 xiu4", [
        mk("absent", "absent", "absent", "hit"),
        mk("absent", "absent", "absent", "absent"),
        deduceMarkCombo("absent", "present", "present", "hit", { combo: "present" }),
        mk("absent", "absent", "absent", "hit"),
      ]),
      deduceGuess("遭遇际会", "zao1 yu4 ji4 hui4", [
        mk("absent", "absent", "absent", "hit"),
        deduceMarkCombo("absent", "present", "present", "absent", { combo: "present" }),
        mk("absent", "absent", "present", "hit"),
        mk("absent", "present", "absent", "hit"),
      ]),
    ];
  }

  // user_yu_combo_rejects_chun_feng_he_qi_with_poly
  it("yu 组合偏淘汰春风和气（脏多音数据）", () => {
    const t = deduceTestTable([["春风和气", "chun1 feng1 he2 qi4"]]);
    // 脏数据：气→yì；春→chū。独立声/韵偏会被拆开满足，组合偏则不应通过
    const poly = deducePolyMap(
      '{"气":{"default":"qi4","alts":["yi4"]},"春":{"default":"chun1","alts":["chu1"]},"和":{"default":"he2","alts":["he4"]}}',
    );
    expect(poly.size).toBe(3);
    const r = filter(t, userYuComboGuesses(), poly, { limit: 200, includePolyphones: true });
    expect(r?.total, "yu 组合偏要求 y+u 同字，春风和气拆开满足时必须淘汰").toBe(0);
  });

  // user_dump_against_sqlite_with_poly（桌面版读用户 sqlite；这里改读真实合并词库 + 真实多音表）
  it("用户调试串 · 真实词库 + 多音表", () => {
    const { table, poly } = realLexicon();
    const r = filter(table, userYuComboGuesses(), poly, { limit: 50, includePolyphones: true });
    expect(r?.items.some((i) => i.word === "春风和气"), "春风和气 must not match yu combo").toBe(false);
    const words = DeduceEngine.matchingWords({ table, guesses: userYuComboGuesses(), polyMap: poly, includePolyphones: true });
    expect(words).not.toContain("春风和气");
    expect(words?.length).toBe(r?.total);
  });

  // combo_with_tone_rejects_same_sm_ym_wrong_tone
  it("含调组合不接受同声韵不同调", () => {
    const wrongTone = ["余音绕梁", "yu2 yin1 rao4 liang2"] as const;
    const rightTone = ["玉树临风", "yu4 shu4 lin2 feng1"] as const;
    // 其它位用罕见声韵，避免「无」误伤候选
    const word = "甲空毓唑";
    const pinyin = "jia3 kong3 yu4 zuo4";
    const guesses = [
      deduceGuess(word, pinyin, [
        mk("absent", "absent", "absent", "absent"),
        mk("absent", "absent", "absent", "absent"),
        deduceMarkCombo("absent", "present", "present", "present", { combo: "present", comboTone: true }),
        mk("absent", "absent", "absent", "absent"),
      ]),
    ];
    const t = deduceTestTable([wrongTone, rightTone]);
    const r = filter(t, guesses, noPoly, { limit: 20 });
    expect(r?.items.some((i) => i.word === "余音绕梁"), "含调组合不应接受同声韵不同调").toBe(false);
    expect(r?.items.some((i) => i.word === "玉树临风"), "含调组合应接受 y+u+4").toBe(true);

    // tone=hit 固定本调，避免「无调组合」再把调 4 标成全局 absent/present
    const noTone = [
      deduceGuess(word, pinyin, [
        mk("absent", "absent", "absent", "absent"),
        mk("absent", "absent", "absent", "absent"),
        deduceMarkCombo("absent", "present", "present", "hit", { combo: "present" }),
        mk("absent", "absent", "absent", "absent"),
      ]),
    ];
    const t2 = deduceTestTable([wrongTone]);
    const r2 = filter(t2, noTone, noPoly, { limit: 20 });
    expect(r2?.items.some((i) => i.word === "余音绕梁"), "无调组合只要求声韵同字").toBe(true);
  });

  /**
   * 用户调试串：神出鬼没 / 偏安一隅 / 清风徐来 / 刀枪不入；答案金瓯无缺
   * 「安」零声母被标无，不能因此淘汰同为第 2 字零声母的「瓯」
   */
  function jinOuWuQueGuesses(): DeduceGuess[] {
    return [
      deduceGuess("神出鬼没", "shen2 chu1 gui3 mo4", [
        mk("absent", "absent", "absent", "present"),
        mk("absent", "absent", "present", "hit"),
        mk("absent", "absent", "absent", "absent"),
        mk("absent", "absent", "absent", "absent"),
      ]),
      deduceGuess("偏安一隅", "pian1 an1 yi4 yu2", [
        mk("absent", "absent", "absent", "hit"),
        mk("absent", "absent", "absent", "hit"),
        mk("absent", "absent", "absent", "absent"),
        mk("absent", "absent", "present", "present"),
      ]),
      deduceGuess("清风徐来", "qing1 feng1 xu2 lai2", [
        mk("absent", "present", "absent", "hit"),
        mk("absent", "absent", "absent", "hit"),
        mk("absent", "absent", "hit", "hit"),
        mk("absent", "absent", "absent", "absent"),
      ]),
      deduceGuess("刀枪不入", "dao1 qiang1 bu4 ru4", [
        mk("absent", "absent", "absent", "hit"),
        mk("absent", "present", "absent", "hit"),
        mk("absent", "absent", "hit", "absent"),
        mk("absent", "absent", "absent", "absent"),
      ]),
    ];
  }

  // zero_initial_absent_keeps_jin_ou_wu_que
  it("零声母标无不淘汰金瓯无缺", () => {
    const t = deduceTestTable([["金瓯无缺", "jin1 ou1 wu2 que1"]]);
    const r = filter(t, jinOuWuQueGuesses(), noPoly, { limit: 20 });
    expect(r?.total, `安的零声母标无不应淘汰金瓯无缺，got ${deduceWords(r)}`).toBe(1);
    expect(r?.items[0]?.word).toBe("金瓯无缺");
  });

  // hit_filters_by_char
  it("hit 按字过滤", () => {
    const t = deduceTestTable([
      ["一心一意", "yi1 xin1 yi1 yi4"],
      ["三心二意", "san1 xin1 er4 yi4"],
    ]);
    const r = filter(t, [deduceGuessAllHit("一心一意", "yi1 xin1 yi1 yi4")], noPoly);
    expect(r?.total).toBe(1);
    expect(r?.items[0].word).toBe("一心一意");
  });

  const zhongLingDraftGuess = (): DeduceGuess =>
    deduceGuess("钟灵毓秀", "zhong1 ling2 yu4 xiu4", [
      mk("absent", "absent", "absent", "absent"),
      mk("absent", "absent", "absent", "hit"),
      mk("absent", "absent", "hit", "hit"),
      mk("absent", "present", "absent", "hit"),
    ]);

  // zhong_ling_yu_xiu_draft_finds_candidates
  it("钟灵毓秀草稿能找到候选", () => {
    const t = deduceTestTable([
      ["爱民恤物", "ai4 min2 xu4 wu4"],
      ["断凫续鹤", "duan4 fu2 xu4 he4"],
      ["好学不倦", "hao4 xue2 bu4 juan4"],
    ]);
    const r = filter(t, [zhongLingDraftGuess()], noPoly);
    expect(r?.total, `expected >=3 candidates, got ${r?.total} ${deduceWords(r)}`).toBeGreaterThanOrEqual(3);
  });

  // filter_merged_lexicon_zhong_ling（同时覆盖桌面 filter_user_sqlite_zhong_ling：那条读用户 sqlite，这里用合并词库）
  it("钟灵毓秀 · 真实合并词库", () => {
    const { table } = realLexicon();
    const r = filter(table, [zhongLingDraftGuess()], noPoly);
    expect(r?.total).toBeGreaterThan(0);
    expect(r?.items.length).toBe(Math.min(200, r?.total ?? 0));
    // 解析后的读音必须真的满足约束：第 2 字调 2 落在 hit，第 3 字韵母 u 且调 4
    for (const c of (r?.items ?? []).slice(0, 50)) {
      expect(c.chars.length, c.word).toBe(4);
      expect(c.chars[1].tone, c.word).toBe(2);
      expect(c.chars[2].ym, c.word).toBe("u");
      expect(c.chars[2].tone, c.word).toBe(4);
      expect(c.chars[3].tone, c.word).toBe(4);
    }
  });

  // Android 版 EngineTest 里的 markFirstChar*：首字「对 / 偏」经 syncPronunciationMarksForChar 带出声韵调后不崩溃、有结果
  it("首字标对 + 自动带出声韵调", () => {
    const t = deduceTestTable([
      ["一骑绝尘", "yi1 qi2 jue2 chen2"],
      ["一帆风顺", "yi1 fan1 feng1 shun4"],
    ]);
    const marks = DeduceEngine.createEmptyMarks(4);
    marks[0].char = "hit";
    syncPronunciationMarksForChar(marks[0]);
    const draft = deduceGuess("一帆风顺", "yi1 fan1 feng1 shun4", marks);
    const active = DeduceEngine.activeGuesses([], draft);
    const r = filter(t, active, noPoly);
    expect(r?.total).toBeGreaterThanOrEqual(1);
    expect(r?.items[0]?.chars[0].c).toBe("一");
    expect(r?.items[0]?.word).toBe("一骑绝尘"); // 一帆风顺 自己的 帆/风/顺 被标「无」
  });

  it("首字标偏不崩溃", () => {
    const t = deduceTestTable([["一帆风顺", "yi1 fan1 feng1 shun4"]]);
    const marks = DeduceEngine.createEmptyMarks(4);
    marks[0].char = "present";
    syncPronunciationMarksForChar(marks[0]);
    const draft = deduceGuess("一帆风顺", "yi1 fan1 feng1 shun4", marks);
    const r = filter(t, DeduceEngine.activeGuesses([], draft), noPoly);
    expect(r?.total).toBeGreaterThanOrEqual(0);
  });
});

// MARK: - SKILL.md「已知坑」回归

describe("DeduceEngine · 已知坑回归", () => {
  /** 占位字：咖 ka5 / 可 ke5，全标「无」。选择罕见声韵 + 轻声，避免误伤候选词。 */
  const filler = () => mk("absent", "absent", "absent", "absent");
  const slot = (c: string, py: string, m: ReturnType<typeof mk>) => [c, py, m] as const;

  // 坑 1：零声母标「无」不得全局排除；安 an1 声母是空串，会误杀同为零声母的「瓯」
  it("坑 1 · 零声母标无不是全局禁用", () => {
    const t = deduceTestTable([
      ["金瓯无缺", "jin1 ou1 wu2 que1"], // 答案
      ["金瓯奥缺", "jin1 ou1 ao4 que1"], // 第 3 位也是零声母，同样不应被刷掉
      ["金按无缺", "jin1 an1 wu2 que1"], // 韵母 an 被标无，必须淘汰
    ]);
    const g = deduceGuessFromSlots([
      slot("天", "tian1", mk("absent", "absent", "absent", "hit")),
      slot("安", "an1", mk("absent", "absent", "absent", "hit")), // 零声母标无 + 韵母 an 无
      slot("板", "ban3", mk("absent", "absent", "absent", "absent")),
      slot("东", "dong1", mk("absent", "absent", "absent", "hit")),
    ]);
    const r = filter(t, [g], noPoly);
    expect(deduceWords(r)).toEqual(["金瓯无缺", "金瓯奥缺"]);
  });

  // 坑 2：owned 与 absent 不对称。字偏 → 声母 x 被「拥有」，别处标无 x 只能 excludeAt，不能全局禁 x
  it("坑 2 · 被拥有的声母只在该位排除", () => {
    const t = deduceTestTable([
      ["天地相想", "tian1 di4 xiang4 xiang3"], // x 出现在第 3、4 位：合法
      ["天西相想", "tian1 xi1 xiang4 xiang3"], // 第 2 位是 x：被该位排除
      ["天鞋相想", "tian1 xie2 xiang4 xiang3"], // 含被标无的字
    ]);
    const g = deduceGuessFromSlots([
      slot("相", "xiang4", createPositionMarks({ char: "present" })), // 字偏：owned sm x / ym iang / tone 4
      slot("鞋", "xie2", mk("absent", "absent", "absent", "absent")), // sm x 标无 → 仅排除第 2 位
      slot("口", "kou2", filler()),
      slot("谋", "mou2", filler()),
    ]);
    const r = filter(t, [g], noPoly);
    expect(deduceWords(r)).toEqual(["天地相想"]);
  });

  // 坑 2（续）：音素「偏」靠 present 回删 absent；没有这条「偏」时 x 会被全局禁用
  it("坑 2（续）· 音素偏回删全局无", () => {
    const cand = ["天地象限", "tian1 di4 xiang4 xian4"] as const;
    const xAtFirst = ["限地象天", "xian4 di4 xiang4 tian1"] as const; // 第 1 位 x：被 G1 的 excludeAt 排除
    const noX = ["天地天地", "tian1 di4 tian1 di4"] as const; // 没有 x：不满足 G2 的偏
    const t = deduceTestTable([cand, xAtFirst, noX]);
    const g1 = deduceGuessFromSlots([
      slot("小", "xiao3", mk("absent", "absent", "absent", "absent")),
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
    ]);
    const g2 = deduceGuessFromSlots([
      slot("咖", "ka5", filler()),
      slot("学", "xue2", mk("absent", "present", "absent", "absent")), // x 须在别处
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
    ]);
    const both = filter(t, [g1, g2], noPoly);
    expect(deduceWords(both)).toEqual(["天地象限"]);
    // 对照：只有 G1 时 x 被全局禁用，天地象限 反而被淘汰
    const only1 = filter(t, [g1], noPoly);
    expect(deduceWords(only1)).not.toContain("天地象限");
  });

  // 坑 3：同值又对又无 —— 韵母 u 已在第 3 字对上，第 4 字「无」只能 excludeAt，不能全局禁 u
  it("坑 3 · 同值又对又无只在该位排除", () => {
    const a = ["古地图园", "gu3 di4 tu2 yuan2"] as const; // 第 1 位也是 u：不能被全局禁
    const b = ["古地图书", "gu3 di4 tu2 shu1"] as const; // 第 4 位 u：被排除
    const c = ["古地天园", "gu3 di4 tian1 yuan2"] as const; // 第 3 位不是 u：fixed 不满足
    const t = deduceTestTable([a, b, c]);
    const g = deduceGuessFromSlots([
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
      slot("布", "bu5", mk("absent", "absent", "hit", "absent")), // ym u 对（第 3 位）
      slot("茹", "ru5", mk("absent", "absent", "absent", "absent")), // ym u 无（第 4 位）
    ]);
    const r = filter(t, [g], noPoly);
    expect(deduceWords(r)).toEqual(["古地图园"]);
  });

  // 坑 3（字对版）：字「对」拥有韵母 u 与声调 4，别处标无只发 excludeAt
  it("坑 3（字对版）", () => {
    const a = ["古地不休", "gu3 di4 bu4 xiu1"] as const; // 第 1 位 u、第 2 位调 4：均合法
    const b = ["古地不故", "gu3 di4 bu4 gu4"] as const; // 第 4 位 u 且调 4：被该位排除
    const t = deduceTestTable([a, b]);
    const g = deduceGuessFromSlots([
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
      slot("不", "bu4", createPositionMarks({ char: "hit" })),
      slot("入", "ru4", mk("absent", "absent", "absent", "absent")),
    ]);
    const r = filter(t, [g], noPoly);
    expect(deduceWords(r)).toEqual(["古地不休"]);
  });

  // 坑 4：多音字默认先按词库读音，全空才展开；includePolyphones=true 则始终展开
  it("坑 4 · 多音字默认先按词库读音，全空才展开", () => {
    const t = deduceTestTable([
      ["和平共处", "he2 ping2 gong4 chu3"],
      ["和而不同", "he2 er2 bu4 tong2"],
      ["行云流水", "xing2 yun2 liu2 shui3"],
    ]);
    const poly = deducePolyMap(
      '{"和":{"default":"he2","alts":["he4"]},"行":{"default":"xing2","alts":["hang2"]}}',
    );
    // 声母 h 对，其余标无：词库默认读音已有 2 条，行云流水(hang2) 不应被带进来
    const hGuess = deduceGuessFromSlots([
      slot("哈", "ha1", mk("absent", "hit", "absent", "absent")),
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
    ]);
    const byDefault = filter(t, [hGuess], poly);
    expect(deduceWords(byDefault)).toEqual(["和平共处", "和而不同"]);
    expect(byDefault?.total).toBe(2);
    // 始终展开：行(hang2) 也算
    const expanded = filter(t, [hGuess], poly, { includePolyphones: true });
    expect(deduceWords(expanded)).toEqual(["和平共处", "和而不同", "行云流水"]);
    expect(expanded?.items[2].pinyin).toBe("háng yún liú shuǐ");
    expect(expanded?.items[0].pinyin).toBe("hé píng gòng chǔ"); // 多音展开时仍优先词库读音
    const words = DeduceEngine.matchingWords({ table: t, guesses: [hGuess], polyMap: poly, includePolyphones: true });
    expect(words).toEqual(["和平共处", "和而不同", "行云流水"]);

    // 默认读音全空 → 保底展开
    const tone4 = deduceGuessFromSlots([
      slot("贺", "he4", mk("absent", "hit", "hit", "hit")),
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
    ]);
    const fallback = filter(t, [tone4], poly);
    expect(deduceWords(fallback)).toEqual(["和平共处", "和而不同"]);
    expect(fallback?.items[0].pinyin).toBe("hè píng gòng chǔ");
    expect(fallback?.items[0].chars[0].tone).toBe(4);
    expect(DeduceEngine.matchingWords({ table: t, guesses: [tone4], polyMap: poly })).toEqual(["和平共处", "和而不同"]);
    // 多音表为空：没有展开的余地，保持 0 条
    const none = filter(t, [tone4], noPoly);
    expect(none?.total).toBe(0);
    expect(DeduceEngine.matchingWords({ table: t, guesses: [tone4], polyMap: noPoly })).toEqual([]);
  });

  // 坑 5：误杀优先于漏杀。同一个字一处标无、另一处标偏时，不能进全局无字表
  it("坑 5 · 偏的字覆盖无的字", () => {
    const t = deduceTestTable([
      ["天地偌人", "tian1 di4 ruo4 ren2"],
      ["天鞋偌人", "tian1 xie3 ruo4 ren2"], // 含被标无的鞋
    ]);
    const g1 = deduceGuessFromSlots([
      slot("偌", "ruo4", mk("absent", "absent", "absent", "absent")),
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
    ]);
    const g2 = deduceGuessFromSlots([
      slot("咖", "ka5", filler()),
      slot("偌", "ruo4", createPositionMarks({ char: "present" })), // 偌在别处
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
    ]);
    const g3 = deduceGuessFromSlots([
      slot("鞋", "xie3", mk("absent", "absent", "absent", "absent")),
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
      slot("咖", "ka5", filler()),
    ]);
    const r = filter(t, [g1, g2, g3], noPoly);
    expect(deduceWords(r)).toEqual(["天地偌人"]);
  });

  // 对优先于无：同位置同值先 hit 后 absent 时，其 excludeAt 被取消，全局无也被撤销
  it("对优先于无", () => {
    const t = deduceTestTable([
      ["金瓯无缺", "jin1 ou1 wu2 que1"],
      ["银瓯无缺", "yin2 ou1 wu2 que1"],
    ]);
    const f = filler();
    const g1 = deduceGuessFromSlots([
      slot("今", "jin1", mk("absent", "hit", "hit", "hit")),
      slot("咖", "ka5", f),
      slot("咖", "ka5", f),
      slot("咖", "ka5", f),
    ]);
    const g2 = deduceGuessFromSlots([
      slot("今", "jin1", mk("absent", "absent", "hit", "hit")), // 同位同值：声母 j 又被标无
      slot("咖", "ka5", f),
      slot("咖", "ka5", f),
      slot("咖", "ka5", f),
    ]);
    const r = filter(t, [g1, g2], noPoly);
    expect(deduceWords(r)).toEqual(["金瓯无缺"]);
  });
});

// MARK: - 接口行为

describe("DeduceEngine · 接口行为", () => {
  it("结果按行序、limit 只截断 items", () => {
    // 同一约束下的三条候选，行序必须保持，limit 只截断 items，total 仍为全部
    const t = deduceTestTable([
      ["一心一意", "yi1 xin1 yi1 yi4"],
      ["三心二意", "san1 xin1 er4 yi4"],
      ["全心全意", "quan2 xin1 quan2 yi4"],
      ["口是心非", "kou3 shi4 xin1 fei1"],
    ]);
    const g = deduceGuess("咖心咖意", "ka5 xin1 ka5 yi4", [
      mk("absent", "absent", "absent", "absent"),
      mk("hit", "hit", "hit", "hit"),
      mk("absent", "absent", "absent", "absent"),
      mk("hit", "hit", "hit", "hit"),
    ]);
    const all = filter(t, [g], noPoly, { limit: 200 });
    expect(deduceWords(all)).toEqual(["一心一意", "三心二意", "全心全意"]);
    expect(all?.items.map((i) => i.row)).toEqual([0, 1, 2]);
    const one = filter(t, [g], noPoly, { limit: 1 });
    expect(deduceWords(one)).toEqual(["一心一意"]);
    expect(one?.total).toBe(3);
    const zero = filter(t, [g], noPoly, { limit: 0 });
    expect(zero?.items).toEqual([]);
    expect(zero?.total).toBe(3);
    expect(DeduceEngine.matchingWords({ table: t, guesses: [g], polyMap: noPoly })).toEqual([
      "一心一意",
      "三心二意",
      "全心全意",
    ]);
  });

  it("空猜测：filter 返回全表，matchingWords 返回空", () => {
    const t = deduceTestTable([
      ["一心一意", "yi1 xin1 yi1 yi4"],
      ["金瓯无缺", "jin1 ou1 wu2 que1"],
    ]);
    const r = filter(t, [], noPoly, { limit: 1 });
    expect(r?.total).toBe(2);
    expect(r?.items.length).toBe(1);
    expect(r?.items[0].word).toBe("一心一意");
    expect(r?.items[0].pinyin).toBe("yī xīn yī yì");
    expect(r?.items[0].chars).toEqual(t.chars(0));
    expect(DeduceEngine.matchingWords({ table: t, guesses: [], polyMap: noPoly })).toEqual([]); // 与 Rust 一致
  });

  it("读音无效的行被跳过", () => {
    const t = deduceTestTable([
      ["坏拼音词", "only one"], // 音节数不符 → invalid
      ["空拼音词", " "], // empty
      ["金瓯无缺", "jin1 ou1 wu2 que1"],
    ]);
    expect(t.flag(0)).toBe(1);
    const g = deduceGuess(
      "金瓯无缺",
      "jin1 ou1 wu2 que1",
      Array.from({ length: 4 }, () => mk("absent", "absent", "absent", "absent")),
    );
    // 全无：非 invalid 行里没有任何与之重叠的候选，invalid 行不能因为"没有约束可违反"被放进来
    const r = filter(t, [g], noPoly);
    expect(r?.total).toBe(0);
    const all = filter(t, [], noPoly);
    expect(all?.total).toBe(1); // 空猜测：只算读音有效的行
  });

  it("词长由最后一条猜测的字数决定", () => {
    const t = deduceTestTable([
      ["一心一意", "yi1 xin1 yi1 yi4"],
      ["一帆风顺利", "yi1 fan1 feng1 shun4 li4"],
    ]);
    const r = filter(t, [deduceGuessAllHit("一心一意", "yi1 xin1 yi1 yi4")], noPoly);
    expect(deduceWords(r)).toEqual(["一心一意"]);
    // 五字猜测只匹配五字词
    const g5 = deduceGuessAllHit("一帆风顺利", "yi1 fan1 feng1 shun4 li4");
    const r5 = filter(t, [g5], noPoly);
    expect(deduceWords(r5)).toEqual(["一帆风顺利"]);
  });

  it("marks 比 chars 短不崩溃（按全无处理）", () => {
    const t = deduceTestTable([["金瓯无缺", "jin1 ou1 wu2 que1"]]);
    const g = deduceGuessAllHit("金瓯无缺", "jin1 ou1 wu2 que1");
    g.marks = g.marks.slice(0, 2); // 后两位按「全无」处理 → 无和缺被标无 → 淘汰
    const r = filter(t, [g], noPoly);
    expect(r?.total).toBe(0);
  });

  it("前后猜测字数不一致不崩溃", () => {
    // 前一条五字、后一条四字：越界的约束被忽略，而不是越界崩溃
    const t = deduceTestTable([["金瓯无缺", "jin1 ou1 wu2 que1"]]);
    const five = deduceGuess("一二三四五", "yi1 er4 san1 si4 wu3", [
      mk("absent", "absent", "absent", "absent"),
      mk("absent", "absent", "absent", "absent"),
      mk("absent", "absent", "absent", "absent"),
      mk("absent", "absent", "absent", "absent"),
      mk("absent", "present", "present", "present"), // 第 5 位的偏：词只有 4 位 → 忽略
    ]);
    const four = deduceGuess(
      "金瓯无缺",
      "jin1 ou1 wu2 que1",
      Array.from({ length: 4 }, () => mk("hit", "hit", "hit", "hit")),
    );
    const r = filter(t, [five, four], noPoly);
    expect(r?.total).toBeGreaterThanOrEqual(0);
  });

  it("取消返回 null", () => {
    const t = deduceTestTable([["金瓯无缺", "jin1 ou1 wu2 que1"]]);
    const g = [deduceGuessAllHit("金瓯无缺", "jin1 ou1 wu2 que1")];
    expect(filter(t, g, noPoly, { isCancelled: () => true })).toBeNull();
    expect(filter(t, [], noPoly, { isCancelled: () => true })).toBeNull();
    expect(DeduceEngine.matchingWords({ table: t, guesses: g, polyMap: noPoly, isCancelled: () => true })).toBeNull();
  });

  it("大表扫描中途取消返回 null 而不是半截结果", () => {
    const { table, poly } = realLexicon();
    const rng = new TestRNG(7);
    const g = DeduceScenarioMaker.makeGuess(table, rng.int(0, table.count - 1), rng.int(0, table.count - 1), 0, rng);
    expect(g).not.toBeNull();
    let calls = 0;
    // 前几次放行，之后取消
    const r = filter(table, [g as DeduceGuess], poly, { isCancelled: () => ++calls > 3 });
    expect(r).toBeNull();
    expect(calls).toBeGreaterThan(3);
  });

  it("异步版本：结果与同步版一致，且可中途取消", async () => {
    const { table, poly } = realLexicon();
    const rng = new TestRNG(11);
    const g = DeduceScenarioMaker.makeGuess(table, rng.int(0, table.count - 1), rng.int(0, table.count - 1), 0, rng) as DeduceGuess;
    const sync = filter(table, [g], poly);
    // sliceMs = 0：每 256 行就让出一次事件循环，覆盖分块路径
    const chunked = await DeduceEngine.filterAsync({ table, guesses: [g], polyMap: poly, sliceMs: 0 });
    expect(chunked).toEqual(sync);
    const wordsSync = DeduceEngine.matchingWords({ table, guesses: [g], polyMap: poly });
    const wordsAsync = await DeduceEngine.matchingWordsAsync({ table, guesses: [g], polyMap: poly, sliceMs: 0 });
    expect(wordsAsync).toEqual(wordsSync);
    let calls = 0;
    const cancelled = await DeduceEngine.filterAsync({ table, guesses: [g], polyMap: poly, sliceMs: 0, isCancelled: () => ++calls > 5 });
    expect(cancelled).toBeNull();
  });

  // MARK: 标记辅助

  it("createEmptyMarks", () => {
    const m = DeduceEngine.createEmptyMarks(3);
    expect(m.length).toBe(3);
    expect(m[0]).toEqual(createPositionMarks());
    expect(DeduceEngine.createEmptyMarks(0)).toEqual([]);
    // 每个字位是独立对象
    m[0].char = "hit";
    expect(m[1].char).toBeNull();
  });

  it("guessHasMark", () => {
    expect(DeduceEngine.guessHasMark(null)).toBe(false);
    const g = deduceGuessAllHit("一心一意", "yi1 xin1 yi1 yi4");
    expect(DeduceEngine.guessHasMark(g)).toBe(true);
    g.marks = DeduceEngine.createEmptyMarks(4);
    expect(DeduceEngine.guessHasMark(g)).toBe(false);
    g.marks[2].combo = "absent";
    expect(DeduceEngine.guessHasMark(g)).toBe(true); // combo 也算
    g.marks[2].combo = null;
    g.marks[3].tone = "present";
    expect(DeduceEngine.guessHasMark(g)).toBe(true);
  });

  it("finalizeMarks", () => {
    const marks = DeduceEngine.createEmptyMarks(4);
    marks[0].char = "hit"; // 字对：未选的声韵调跟随字（自动）
    marks[1].char = "present";
    marks[1].sm = "absent"; // 字偏 + 人选声母无：声母保持人选，韵调自动
    marks[2].sm = "hit";
    marks[2].autoSm = true; // 自动带出的声母被覆盖为字的状态（char 为空 → 不覆盖，但 auto 清零）
    marks[3].combo = "present";
    marks[3].comboTone = true;
    const out = DeduceEngine.finalizeMarks(marks);

    expect(out[0]).toEqual(
      createPositionMarks({
        char: "hit", sm: "hit", ym: "hit", tone: "hit", combo: "absent", autoSm: true, autoYm: true, autoTone: true,
      }),
    );
    expect(out[1].char).toBe("present");
    expect(out[1].sm).toBe("absent");
    expect(out[1].autoSm).toBe(false);
    expect(out[1].ym).toBe("present");
    expect(out[1].autoYm).toBe(true);
    expect(out[1].tone).toBe("present");
    expect(out[2].char).toBe("absent");
    expect(out[2].sm).toBe("hit");
    expect(out[2].autoSm, "字不存在时 auto 标记清零").toBe(false);
    expect(out[2].ym).toBe("absent");
    expect(out[3].combo).toBe("present");
    expect(out[3].comboTone).toBe(true);
    // comboTone 只在 combo == present 时保留
    marks[3].combo = "hit";
    expect(DeduceEngine.finalizeMarks(marks)[3].comboTone).toBe(false);
  });

  it("activeGuesses", () => {
    const a = deduceGuessAllHit("一心一意", "yi1 xin1 yi1 yi4");
    const b = deduceGuessAllHit("金瓯无缺", "jin1 ou1 wu2 que1");
    // 无草稿 / 草稿无标记 → 原样
    expect(DeduceEngine.activeGuesses([a, b], null)).toEqual([a, b]);
    const empty = deduceGuess("三心二意", "san1 xin1 er4 yi4", DeduceEngine.createEmptyMarks(4));
    expect(DeduceEngine.activeGuesses([a], empty)).toEqual([a]);

    // 新词面 → 追加（标记已定稿：未选 → 无）
    empty.marks[0].char = "hit";
    const appended = DeduceEngine.activeGuesses([a, b], empty);
    expect(appended.length).toBe(3);
    expect(appended[2].word).toBe("三心二意");
    expect(appended[2].marks[1].char).toBe("absent");
    expect(appended[2].marks[0].sm).toBe("hit");
    expect(appended[2].marks[0].autoSm).toBe(true);

    // 同词面 → 替换
    const sameWord: DeduceGuess = { ...a, marks: a.marks.map((m) => ({ ...m })) };
    sameWord.marks[0].char = "absent";
    const replaced = DeduceEngine.activeGuesses([a, b], sameWord);
    expect(replaced.length).toBe(2);
    expect(replaced[0].marks[0].char).toBe("absent");

    // editIndex 优先于词面
    const edit: DeduceGuess = { ...empty, editIndex: 1 };
    const edited = DeduceEngine.activeGuesses([a, b], edit);
    expect(edited.map((g) => g.word)).toEqual(["一心一意", "三心二意"]);
    // editIndex 越界 → 退回按词面处理
    edit.editIndex = 9;
    expect(DeduceEngine.activeGuesses([a, b], edit).length).toBe(3);
    // 不改动入参
    expect(a.marks[0].char).toBe("hit");
    expect(empty.marks[1].char).toBeNull();
  });
});

// MARK: - 与字符串级参考实现的差分（真实词库 + 随机场景）

describe("DeduceEngine · 与参考实现差分", () => {
  function compare(table: ReturnType<typeof deduceTestTable>, poly: PolyphoneMap, guesses: DeduceGuess[], include: boolean, label: string): void {
    const ref = DeduceReference.filter(table, guesses, poly, include);
    const got = DeduceEngine.filter({ table, guesses, polyMap: poly, limit: 40, includePolyphones: include });
    const words = DeduceEngine.matchingWords({ table, guesses, polyMap: poly, includePolyphones: include });
    expect(got, `${label}: 返回 null`).not.toBeNull();
    expect(words, `${label}: 返回 null`).not.toBeNull();
    if (got === null || words === null) return;
    expect(got.total, `${label}: total`).toBe(ref.length);
    expect(words, `${label}: matchingWords`).toEqual(ref.map((h) => h.word));
    expect(
      got.items.map((i) => i.row),
      `${label}: items 行序`,
    ).toEqual(ref.slice(0, 40).map((h) => h.row));
    got.items.forEach((g, i) => {
      const r = ref[i];
      expect(g.chars, `${label}: ${g.word} 读音`).toEqual(r.chars);
      expect(g.pinyin, `${label}: ${g.word} 拼音`).toBe(charsToMarkedPinyin(r.chars));
    });
  }

  it("随机场景与参考实现一致（真实词库 8000 条子表）", () => {
    // 参考实现是字符串级的，很慢：对真实词库随机抽 8000 条四字词建子表做主体差分
    const { table: full, poly } = realLexicon();
    const rng = new TestRNG(20261019);
    const table = deduceSubTable(full, 8000, rng);
    const fourChar: number[] = [];
    for (let i = 0; i < table.count; i++) if (table.length(i) === 4) fourChar.push(i);
    expect(fourChar.length).toBeGreaterThan(1000);

    let nonEmpty = 0;
    const scenarios = 40;
    for (let n = 0; n < scenarios; n++) {
      const answer = rng.pick(fourChar);
      const guessCount = rng.int(1, 4);
      const noise = rng.pick([0.0, 0.0, 0.05, 0.2]);
      const guesses: DeduceGuess[] = [];
      for (let k = 0; k < guessCount; k++) {
        const g = DeduceScenarioMaker.makeGuess(table, rng.pick(fourChar), answer, noise, rng);
        if (g) guesses.push(g);
      }
      if (guesses.length === 0) continue;
      for (const include of [false, true]) {
        compare(table, poly, guesses, include, `场景#${n} include=${include} noise=${noise}`);
      }
      const r = DeduceEngine.filter({ table, guesses, polyMap: poly });
      if (r && r.total > 0) nonEmpty += 1;
    }
    expect(nonEmpty, "随机场景应有相当比例产生非空候选，否则差分没有意义").toBeGreaterThan(scenarios / 3);
  });

  it("无噪声标记不会把答案刷掉（整表）", () => {
    // 无噪声（标记完全由真实答案推出，combo 仅在答案里确有同字共现时才标）时，答案不应被刷掉
    const { table, poly } = realLexicon();
    const rng = new TestRNG(99);
    const fourChar: number[] = [];
    for (let i = 0; i < table.count; i++) if (table.length(i) === 4) fourChar.push(i);
    let killed = 0;
    const trials = 120;
    for (let t = 0; t < trials; t++) {
      const answer = rng.pick(fourChar);
      const guesses: DeduceGuess[] = [];
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const g = DeduceScenarioMaker.makeGuess(table, rng.pick(fourChar), answer, 0, rng);
        if (g) guesses.push(g);
      }
      const words = DeduceEngine.matchingWords({ table, guesses, polyMap: poly, includePolyphones: true }) ?? [];
      if (!words.includes(table.word(answer))) killed += 1;
    }
    expect(killed, `无噪声的标记不应把答案刷掉：${killed}/${trials}`).toBe(0);
  });

  it("多音字小表与参考实现一致", () => {
    const t = deduceTestTable([
      ["和平共处", "he2 ping2 gong4 chu3"],
      ["和而不同", "he2 er2 bu4 tong2"],
      ["行云流水", "xing2 yun2 liu2 shui3"],
      ["长治久安", "chang2 zhi4 jiu3 an1"],
      ["长年累月", "chang2 nian2 lei3 yue4"],
    ]);
    const poly = deducePolyMap(
      '{"和":{"default":"he2","alts":["he4","huo2","he2"]},"行":{"default":"xing2","alts":["hang2"]},' +
        '"长":{"default":"chang2","alts":["zhang3"]},"累":{"default":"lei4","alts":["lei3","lei2"]}}',
    );
    const rng = new TestRNG(5);
    for (let n = 0; n < 150; n++) {
      const answer = rng.int(0, t.count - 1);
      const guesses: DeduceGuess[] = [];
      const cnt = rng.int(1, 3);
      for (let k = 0; k < cnt; k++) {
        const g = DeduceScenarioMaker.makeGuess(t, rng.int(0, t.count - 1), answer, 0.3, rng);
        if (g) guesses.push(g);
      }
      if (guesses.length === 0) continue;
      for (const include of [false, true]) compare(t, poly, guesses, include, `小表#${n} include=${include}`);
    }
  });

  /** 大表（4 万条合成数据）：结果保持行序，且与参考实现、分块版一致。 */
  it("大表扫描保持行序", async () => {
    const chars = Array.from("甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥天地玄黄宇宙洪荒日月盈昃");
    const pys = [
      "jia3", "yi3", "bing3", "ding1", "wu4", "ji3", "geng1", "xin1", "ren2", "gui3", "zi3", "chou3",
      "yin2", "mao3", "chen2", "si4", "wu3", "wei4", "shen1", "you3", "xu1", "hai4", "tian1", "di4",
      "xuan2", "huang2", "yu3", "zhou4", "hong2", "huang1", "ri4", "yue4", "ying2", "ze4",
    ];
    expect(chars.length).toBe(pys.length);
    const rng = new TestRNG(1);
    const items: (readonly [string, string])[] = [];
    for (let i = 0; i < 40_000; i++) {
      const idx = [0, 1, 2, 3].map(() => rng.int(0, chars.length - 1));
      items.push([idx.map((k) => chars[k]).join(""), idx.map((k) => pys[k]).join(" ")]);
    }
    const t = deduceTestTable(items);
    expect(t.count).toBeGreaterThan(16_384);
    const g = deduceGuessFromSlots([
      ["天", "tian1", createPositionMarks({ char: "hit" })],
      ["地", "di4", createPositionMarks({ char: "present" })],
      ["咖", "ka5", mk("absent", "absent", "absent", "absent")],
      ["咖", "ka5", mk("absent", "absent", "absent", "absent")],
    ]);
    const r = filter(t, [g], noPoly, { limit: 20 });
    const ref = DeduceReference.filter(t, [g], noPoly, false);
    expect(ref.length, "合成数据应产生足够多的匹配").toBeGreaterThan(40);
    expect(r?.total).toBe(ref.length);
    expect(r?.items.map((i) => i.row)).toEqual(ref.slice(0, 20).map((h) => h.row));
    const rows = r?.items.map((i) => i.row) ?? [];
    expect(rows).toEqual([...rows].sort((a, b) => a - b));
    const words = DeduceEngine.matchingWords({ table: t, guesses: [g], polyMap: noPoly });
    expect(words).toEqual(ref.map((h) => h.word));

    // 分块扫描 vs 一次扫描：total 与前 keep 行完全一致
    const plan = new DeducePlan(t, mergeDeduceConstraints([g]), null, false);
    for (const keep of [0, 5, 20, Infinity]) {
      const whole = DeduceEngine.scan(plan, keep, () => false);
      const sliced = await DeduceEngine.scanAsync(plan, keep, () => false, 0);
      expect(sliced?.total, `keep=${keep}`).toBe(whole?.total);
      expect(sliced?.rows, `keep=${keep}`).toEqual(whole?.rows);
      expect(whole?.total).toBe(ref.length);
      expect(whole?.rows.length).toBe(Math.min(keep, ref.length));
    }
    // 分块中途取消 → null
    let calls = 0;
    expect(await DeduceEngine.scanAsync(plan, 20, () => ++calls > 5, 0)).toBeNull();
  });

  /** 约束里出现词库字符串表之外的声母 / 韵母 / 声调时，要给它们追加新码，且不影响其它匹配。 */
  it("约束值在词库字符串表之外", () => {
    const t = deduceTestTable([["金瓯无缺", "jin1 ou1 wu2 que1"]]);
    // 猜测里出现词库没有的声母 zh / 韵母 iong / 调 7、9（手工构造的 CharData）
    const weird = (lastToneHit: boolean): DeduceGuess => ({
      word: "穷凶极恶",
      pinyin: "qiong7 xiong1 zhi9 e4",
      chars: [
        { c: "穷", py: "zhiong", sm: "zh", ym: "iong", tone: 7 },
        { c: "凶", py: "xiong", sm: "x", ym: "iong", tone: 1 },
        { c: "极", py: "zhi", sm: "zh", ym: "i", tone: 9 },
        { c: "恶", py: "e", sm: "", ym: "e", tone: 4 },
      ] as CharData[],
      marks: [
        mk("absent", "absent", "absent", "absent"), // 表外声母 / 韵母 / 调全标无：不影响金瓯无缺
        mk("absent", "absent", "absent", "hit"), // 调 1 对：瓯 ou1 满足
        mk("absent", "absent", "absent", "absent"),
        mk("absent", "absent", "absent", lastToneHit ? "hit" : "absent"), // 调 4 对：缺是 1 调 → 淘汰
      ],
      editIndex: null,
    });
    const ok = filter(t, [weird(false)], noPoly);
    expect(deduceWords(ok)).toEqual(["金瓯无缺"]);
    const no = filter(t, [weird(true)], noPoly);
    expect(no?.total).toBe(0);
    // 表外的值要求「对」：永远匹配不上
    const hit = weird(false);
    hit.marks[0] = mk("absent", "hit", "absent", "absent");
    expect(filter(t, [hit], noPoly)?.total).toBe(0);
    // 多字符的「字」永远匹配不上任何词库字
    const multi = weird(false);
    multi.chars[0] = { c: "金瓯", py: "jin", sm: "j", ym: "in", tone: 1 };
    multi.marks[0] = mk("hit", "hit", "hit", "hit");
    expect(filter(t, [multi], noPoly)?.total).toBe(0);
    expect(DeduceEngine.matchingWords({ table: t, guesses: [multi], polyMap: noPoly })).toEqual([]);
  });
});
