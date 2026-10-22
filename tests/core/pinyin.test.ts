import { describe, expect, it } from "vitest";
import { LexiconBaker } from "../../src/core/lexicon/catalog";
import { IdiomTable } from "../../src/core/lexicon/idiomTable";
import {
  buildChars,
  charsToDigitPinyin,
  charsToMarkedPinyin,
  formatPinyinAsDigit,
  charsFromWordPinyin,
  markSyllable,
  normalizePinyinInput,
  parseSyllable,
  stripTone,
  toneDigit,
  toneLabel,
} from "../../src/core/pinyin/pinyin";
import {
  buildPolyphoneMap,
  charsToDisplayPinyin,
  formatReadingDigit,
  readingsForChar,
  syncPronunciationMarksForChar,
} from "../../src/core/pinyin/polyphone";
import { createPositionMarks } from "../../src/core/model/types";
import { trimUnicodeWhitespace } from "../../src/core/text";

describe("Pinyin", () => {
  // 移植自 pinyin.rs tests
  it("parseSyllable dan4", () => {
    const ch = parseSyllable("dan4");
    expect(ch.sm).toBe("d");
    expect(ch.ym).toBe("an");
    expect(ch.tone).toBe(4);
    expect(ch.py).toBe("dan");
  });

  it("normalize 标调与数字调", () => {
    expect(normalizePinyinInput("xián zhāng chě jù")).toBe("xián zhāng chě jù");
    expect(normalizePinyinInput("xian2 zhang1 che3 ju4")).toBe("xián zhāng chě jù");
  });

  it("markSyllable 含 ü / 标调位置", () => {
    expect(markSyllable("nve4")).toBe("nüè");
    expect(markSyllable("lve4")).toBe("lüè");
    expect(markSyllable("nv3")).toBe("nǚ");
    expect(markSyllable("xiu4")).toBe("xiù");
    expect(markSyllable("gui1")).toBe("guī");
    expect(markSyllable("hao3")).toBe("hǎo");
    expect(markSyllable("lv5")).toBe("lü");
    expect(markSyllable("bu4")).toBe("bù");
  });

  it("零声母与 zh/ch/sh", () => {
    const an = parseSyllable("ān");
    expect(an.sm).toBe("");
    expect(an.ym).toBe("an");
    expect(an.tone).toBe(1);
    const zhang = parseSyllable("zhāng");
    expect(zhang.sm).toBe("zh");
    expect(zhang.ym).toBe("ang");
    const er = parseSyllable("er5");
    expect(er.sm).toBe("");
    expect(er.ym).toBe("er");
    expect(er.tone).toBe(5);
  });

  it("无调号按轻声", () => {
    expect(parseSyllable("de").tone).toBe(5);
    expect(parseSyllable("de5").tone).toBe(5);
  });

  /** ü 的两种写法必须得到同一个读音（与 Rust 的有意差异，见 pinyin.ts 注释） */
  it("ü 统一规范为 v", () => {
    const a = parseSyllable("lǜ");
    const b = parseSyllable("lv4");
    const c = parseSyllable("lü4");
    expect(a).toEqual(b);
    expect(b).toEqual(c);
    expect(a.ym).toBe("v");
    expect(a.py).toBe("lv");
    expect(a.tone).toBe(4);
    // 展示时仍是 ü
    expect(markSyllable(a.py + toneDigit(a.tone))).toBe("lǜ");
  });

  it("buildChars", () => {
    const chars = buildChars("弹无虚发", "dàn wú xū fā");
    expect(chars?.length).toBe(4);
    expect(chars?.[0]).toEqual({ c: "弹", py: "dan", sm: "d", ym: "an", tone: 4 });
    expect(buildChars("弹无虚发", "dàn wú xū")).toBeNull();
  });

  it("数字调往返", () => {
    const chars = buildChars("国不堪贰", "guó bù kān èr") ?? [];
    expect(charsToDigitPinyin(chars)).toBe("guo2 bu4 kan1 er4");
    expect(charsToMarkedPinyin(chars)).toBe("guó bù kān èr");
    expect(formatPinyinAsDigit("guó bù kān èr")).toBe("guo2 bu4 kan1 er4");
  });

  it("多音字表与展示补调", () => {
    const json = '{"不":{"default":"bù","alts":["bú","bū"]},"单":{"default":"dān","alts":["shàn","chán"]},"无":{"default":"wú"}}';
    const map = buildPolyphoneMap(json);
    expect(map.size).toBe(2); // “无”没有备选读音，不进表
    const bu = { c: "不", py: "bu", sm: "b", ym: "u", tone: 4 };
    expect(readingsForChar(bu, map).map(formatReadingDigit)).toEqual(["bu4", "bu2", "bu1"]);
    // 轻声补调：词库里写成无调的“不”，在多音表里能找到同音节的实际声调
    const neutral = { c: "不", py: "bu", sm: "b", ym: "u", tone: 5 };
    expect(charsToDisplayPinyin([neutral], map)).toBe("bù");
    expect(charsToDisplayPinyin([neutral], null)).toBe("bu");
  });

  it("多音字表结构不对时整体为空，非法音节跳过", () => {
    expect(buildPolyphoneMap("not json").size).toBe(0);
    expect(buildPolyphoneMap("[]").size).toBe(0);
    expect(buildPolyphoneMap('{"行":{"alts":["háng"]}}').size).toBe(0); // 缺 default：整体解码失败
    expect(buildPolyphoneMap('{"行":{"default":"xíng","alts":["háng",5]}}').size).toBe(0);
    const m = buildPolyphoneMap('{"行":{"default":"xíng","alts":["","háng","xíng","hang2"]},"": {"default":"a","alts":["b"]}}');
    expect(m.size).toBe(1); // 空键跳过
    expect(m.get("行")?.alts.map((r) => r.py + r.tone)).toEqual(["hang2"]); // 空串、与默认重复、重复项都去掉
  });

  /**
   * trim 按 Unicode White_Space 属性，与 Rust `str::trim` 一致：
   * 全角空格 U+3000、NBSP 会被裁掉，零宽空格 U+200B 与 BOM U+FEFF 不会。
   * （部分释义以 U+200B 开头；JS 自带的 trim 会误裁 U+FEFF。）
   */
  it("trim 遵循 Unicode White_Space", () => {
    expect(trimUnicodeWhitespace("\u3000 比喻\u00A0\n")).toBe("比喻");
    expect(trimUnicodeWhitespace("\u200B比喻")).toBe("\u200B比喻");
    expect(trimUnicodeWhitespace("\uFEFF比喻")).toBe("\uFEFF比喻");
    expect(trimUnicodeWhitespace("  \t\n ")).toBe("");
    expect(trimUnicodeWhitespace("")).toBe("");
    const { builder } = LexiconBaker.bake([{ word: "一心一意", pinyin: "yi1 xin1 yi1 yi4", explanation: "\u200B比喻。" }]);
    const t = IdiomTable.open(builder.serialize());
    expect(t.explanation(0)).toBe("\u200B比喻。");
  });

  it("syncPronunciationMarksForChar", () => {
    let m = createPositionMarks({ char: "hit" });
    syncPronunciationMarksForChar(m);
    expect([m.sm, m.ym, m.tone]).toEqual(["hit", "hit", "hit"]);
    expect(m.autoSm && m.autoYm && m.autoTone).toBe(true);
    // 人选的声母保持不变
    m = createPositionMarks({ char: "present", sm: "absent" });
    syncPronunciationMarksForChar(m);
    expect(m.sm).toBe("absent");
    expect(m.autoSm).toBe(false);
    expect(m.ym).toBe("present");
    // 字取消后，只撤回自动带出的
    m.char = null;
    syncPronunciationMarksForChar(m);
    expect(m.sm).toBe("absent");
    expect(m.ym).toBeNull();
    expect(m.tone).toBeNull();
  });

  it("toneLabel / toneDigit 边界", () => {
    expect(toneLabel(1)).toBe("1");
    expect(toneLabel(4)).toBe("4");
    expect(toneLabel(5)).toBe("轻");
    expect(toneLabel(0)).toBe("轻");
    expect(toneDigit(3)).toBe("3");
    expect(toneDigit(9)).toBe("5");
    expect(toneDigit(0)).toBe("5");
  });
});

// —— Unicode 规范化：与 Swift `Character` 的规范等价语义一致 ——
describe("Pinyin 规范化 NFC / NFD", () => {
  const nfd = (s: string): string => s.normalize("NFD");

  it("分解写法（字母 + 组合符号）与预组合写法得到同一读音", () => {
    for (const marked of ["jiàn", "xián", "lǜ", "nǚ", "ān", "zhōng", "chǎng", "hǎo"]) {
      const decomposed = nfd(marked);
      expect(decomposed).not.toBe(marked); // 确认构造出的确实是分解形式
      expect(parseSyllable(decomposed)).toEqual(parseSyllable(marked));
      expect(markSyllable(decomposed)).toBe(marked); // 输出统一为预组合
      expect(stripTone(decomposed)).toEqual(stripTone(marked));
    }
  });

  it("整段拼音规范化后字符串可直接 === 比较", () => {
    expect(normalizePinyinInput(nfd("xián zhāng chě jù"))).toBe("xián zhāng chě jù");
    expect(formatPinyinAsDigit(nfd("guó bù kān èr"))).toBe("guo2 bu4 kan1 er4");
    const chars = charsFromWordPinyin("国不堪贰", nfd("guó bù kān èr")) ?? [];
    expect(charsToMarkedPinyin(chars)).toBe("guó bù kān èr");
    expect(charsToDigitPinyin(chars)).toBe("guo2 bu4 kan1 er4");
  });

  it("ü 的分解写法（u + U+0308）等同于 v", () => {
    expect(parseSyllable("lu\u0308e4")).toEqual(parseSyllable("lve4"));
    expect(parseSyllable("nu\u0308")).toEqual(parseSyllable("nv5"));
  });

  it("成语字符按码点处理，不拆代理对", () => {
    const word = "𠮷a𠮷b"; // 𠮷 是 U+20BB7，UTF-16 里占两个码元
    const chars = buildChars(word, "ji2 a1 ji2 b1");
    expect(chars?.length).toBe(4);
    expect(chars?.map((c) => c.c)).toEqual(["𠮷", "a", "𠮷", "b"]);
    expect(buildChars(word, "ji2 a1 ji2")).toBeNull();
  });
});
