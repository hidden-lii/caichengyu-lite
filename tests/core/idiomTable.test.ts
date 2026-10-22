import { describe, expect, it } from "vitest";
import {
  LexiconBaker,
  LexiconCatalog,
  LexiconEdits,
  LexiconMerger,
} from "../../src/core/lexicon/catalog";
import { IdiomTable, IdiomTableError, ReadingFlag } from "../../src/core/lexicon/idiomTable";
import type { IdiomInput } from "../../src/core/model/types";

function table(items: IdiomInput[]): IdiomTable {
  const { builder } = LexiconBaker.bake(items);
  return IdiomTable.open(builder.serialize());
}

function item(word: string, pinyin: string, explanation = ""): IdiomInput {
  return { word, pinyin, explanation };
}

function words(t: IdiomTable): string[] {
  return Array.from({ length: t.count }, (_, i) => t.word(i));
}

describe("IdiomTable", () => {
  it("往返", () => {
    const t = table([
      item("弹无虚发", "dàn wú xū fā", "释义一"),
      item("国不堪贰", "guó bù kān èr"),
      item("坏拼音", "only one"), // 音节数不符 → invalid
      item("空拼音词", "  "), // 空 → empty
    ]);
    expect(t.count).toBe(4);
    expect(t.word(0)).toBe("弹无虚发");
    expect(t.length(0)).toBe(4);
    expect(t.explanation(0)).toBe("释义一");
    expect(t.explanation(1)).toBe("");
    expect(t.hasExplanation(1)).toBe(false);
    expect(t.flag(0)).toBe(ReadingFlag.valid);
    expect(t.flag(2)).toBe(ReadingFlag.invalid);
    expect(t.flag(3)).toBe(ReadingFlag.empty);
    expect(t.chars(0)[0]).toEqual({ c: "弹", py: "dan", sm: "d", ym: "an", tone: 4 });
    expect(t.pinyin(1)).toBe("guó bù kān èr");
    expect(t.chars(2)).toEqual([]);
    expect(t.smStrings[0]).toBe("");
    expect(t.ymStrings[0]).toBe("");
  });

  it("按词面查行号", () => {
    const t = table([item("一心一意", "yī xīn yī yì"), item("金瓯无缺", "jīn ōu wú quē")]);
    expect(t.rowForWord("金瓯无缺")).toBe(1);
    expect(t.rowForWord("一心一意")).toBe(0);
    expect(t.rowForWord("不存在")).toBeNull();
    expect(IdiomTable.empty.rowForWord("一心一意")).toBeNull();
  });

  it("空表", () => {
    expect(IdiomTable.empty.count).toBe(0);
  });

  it("含非 BMP 字符的词（按码点存取与查找）", () => {
    const t = table([item("𠮷心𠮷意", "ji2 xin1 ji2 yi4")]);
    expect(t.length(0)).toBe(4);
    expect(t.word(0)).toBe("𠮷心𠮷意");
    expect(t.chars(0).map((c) => c.c)).toEqual(["𠮷", "心", "𠮷", "意"]);
    expect(t.rowForWord("𠮷心𠮷意")).toBe(0);
  });

  it("起点不对齐的字节也能打开（内部拷贝对齐）", () => {
    const { builder } = LexiconBaker.bake([item("弹无虚发", "dàn wú xū fā", "x")]);
    const bytes = builder.serialize();
    const padded = new Uint8Array(bytes.length + 3);
    padded.set(bytes, 3);
    const t = IdiomTable.open(padded.subarray(3));
    expect(t.word(0)).toBe("弹无虚发");
    expect(t.explanation(0)).toBe("x");
  });

  it("损坏会被发现", () => {
    const { builder } = LexiconBaker.bake([
      item("弹无虚发", "dàn wú xū fā", "x"),
      item("国不堪贰", "guó bù kān èr"),
    ]);
    const good = builder.serialize();
    const kindOf = (fn: () => unknown): string | undefined => {
      try {
        fn();
      } catch (e) {
        return e instanceof IdiomTableError ? e.kind : "other";
      }
      return undefined;
    };
    // 索引区翻转一个字节 → 校验失败
    const flipped = good.slice();
    flipped[100] ^= 0xff;
    expect(kindOf(() => IdiomTable.open(flipped))).toBe("checksumMismatch");
    // 截断
    expect(kindOf(() => IdiomTable.open(good.subarray(0, good.length - 4)))).toBe("truncated");
    expect(kindOf(() => IdiomTable.open(good.subarray(0, 10)))).toBe("truncated");
    // 非索引文件
    expect(kindOf(() => IdiomTable.open(new Uint8Array(128)))).toBe("badMagic");
    // 版本不支持
    const v2 = good.slice();
    v2[4] = 2;
    expect(kindOf(() => IdiomTable.open(v2))).toBe("unsupportedVersion");
  });
});

describe("LexiconMerge", () => {
  const merged = (tables: IdiomTable[]): IdiomTable => IdiomTable.open(LexiconMerger.merge(tables).builder.serialize());

  // 移植自 sqlite.rs: merge_high_priority_pinyin_wins
  it("高优先级拼音胜出", () => {
    const low = table([item("一心一意", "yi1 xin1 yi1 yi4", "低释义")]);
    const high = table([item("一心一意", "yī xīn yī yì", "高释义")]);
    const m = merged([high, low]);
    expect(m.count).toBe(1);
    expect(m.pinyin(0)).toBe("yī xīn yī yì");
    expect(m.explanation(0)).toBe("高释义");
  });

  // 移植自 sqlite.rs: merge_empty_explanation_falls_back
  it("空释义回退到低优先级", () => {
    const low = table([item("金瓯无缺", "jin1 ou1 wu2 que1", "低释义保留")]);
    const high = table([item("金瓯无缺", "jīn ōu wú quē", "")]);
    const m = merged([high, low]);
    expect(m.count).toBe(1);
    expect(m.pinyin(0)).toBe("jīn ōu wú quē");
    expect(m.explanation(0)).toBe("低释义保留");
  });

  // 移植自 sqlite.rs: merge_union_keeps_unique_words（原用例的占位拼音换成合法拼音）
  it("并集保留各自独有的词，输出顺序 = 从最低优先级开始的首次出现顺序", () => {
    const low = table([item("一心一意", "yi1 xin1 yi1 yi4", "低"), item("只在低源", "zhi3 zai4 di1 yuan2", "仅低")]);
    const high = table([item("一心一意", "yī xīn yī yì", "高"), item("只在高源", "zhi3 zai4 gao1 yuan2", "仅高")]);
    const m = merged([high, low]);
    expect(m.count).toBe(3);
    // 输出顺序 = 从最低优先级开始的首次出现顺序（与桌面一致，影响候选展示顺序）
    expect(words(m)).toEqual(["一心一意", "只在低源", "只在高源"]);
    expect(m.explanation(0)).toBe("高");
  });

  /** 桌面行为：高优先级源的坏拼音会覆盖低优先级的好拼音，合并后整词被丢。 */
  it("读音无效的胜出者让整词被丢弃", () => {
    const low = table([item("金瓯无缺", "jīn ōu wú quē", "好")]);
    const high = table([item("金瓯无缺", "jīn ōu wú quē （缺）", "坏")]);
    const out = LexiconMerger.merge([high, low]);
    expect(out.dropped).toBe(1);
    expect(out.builder.count).toBe(0);
  });

  /** 空拼音不覆盖低优先级读音（只有读音非空才覆盖）。 */
  it("空拼音不覆盖低优先级读音", () => {
    const low = table([item("金瓯无缺", "jīn ōu wú quē", "低")]);
    const high = table([item("金瓯无缺", "  ", "高")]);
    const m = merged([high, low]);
    expect(m.count).toBe(1);
    expect(m.pinyin(0)).toBe("jīn ōu wú quē");
    expect(m.explanation(0)).toBe("高");
  });

  it("同一来源内的重复词", () => {
    const t = table([item("一心一意", "yi1 xin1 yi1 yi4", "a"), item("一心一意", "yī xīn yí yì", "")]);
    const m = merged([t]);
    expect(m.count).toBe(1);
    expect(m.pinyin(0)).toBe("yī xīn yí yì");
    expect(m.explanation(0)).toBe("a");
  });

  it("仅四字过滤", () => {
    const { builder, stats } = LexiconBaker.bake(
      [item("一心一意", "yi1 xin1 yi1 yi4"), item("三心二意不专", "san1 xin1 er4 yi4 bu4 zhuan1")],
      true,
    );
    expect(builder.count).toBe(1);
    expect(stats.droppedNotFourChar).toBe(1);
  });

  it("目录优先级", () => {
    expect(LexiconCatalog.defaultSelection).toEqual([
      "hanyuguoxue", "zdic", "hwxnet", "baidu", "chinesewords", "xinhua", "toollu", "moe", "merged",
    ]);
    expect(LexiconCatalog.sortedByDefaultPriority(["merged", "zdic", "zdic", "nope"])).toEqual(["zdic", "merged"]);
  });
});

describe("LexiconEdits", () => {
  it("改读音 / 删除 / 新增", () => {
    const base = table([
      item("一心一意", "yī xīn yī yì", "释义甲"),
      item("金瓯无缺", "jīn ōu wú quē", "释义乙"),
      item("弹无虚发", "dàn wú xū fā", "释义丙"),
    ]);
    const edits = new LexiconEdits();
    edits.set("金瓯无缺", "jin1 ou3 wu2 que1", null); // 改读音，保留释义
    edits.delete("弹无虚发");
    edits.set("新增成语", "xin1 zeng1 cheng2 yu3", "新释义");
    const out = IdiomTable.open(edits.apply(base).serialize());
    expect(words(out)).toEqual(["一心一意", "金瓯无缺", "新增成语"]); // 原位替换 + 末尾追加
    expect(out.pinyin(1)).toBe("jīn ǒu wú quē");
    expect(out.explanation(1)).toBe("释义乙");
    expect(out.explanation(2)).toBe("新释义");
  });

  it("新读音无效时保持原条目", () => {
    const base = table([item("金瓯无缺", "jīn ōu wú quē", "x")]);
    const edits = new LexiconEdits();
    edits.set("金瓯无缺", "jin1", null);
    const out = IdiomTable.open(edits.apply(base).serialize());
    expect(out.pinyin(0)).toBe("jīn ōu wú quē");
  });

  it("指纹随改动变化", () => {
    const a = new LexiconEdits();
    const empty = a.fingerprint;
    a.set("x", "y", null);
    expect(a.fingerprint).not.toBe(empty);
    const b = new LexiconEdits();
    b.set("x", "y", null);
    expect(a.fingerprint).toBe(b.fingerprint);
  });

  it("再次 set 沿用先前新增时的释义", () => {
    const e = new LexiconEdits();
    e.set("新增成语", "xin1 zeng1 cheng2 yu3", "释义");
    e.set("新增成语", "xin1 zeng1 cheng2 yu4", null);
    expect(e.items.length).toBe(1);
    expect(e.items[0].explanation).toBe("释义");
  });

  it("持久化格式：键按字母序、空值省略，可往返；结构不对解码为 null", () => {
    const e = new LexiconEdits();
    e.set("新增成语", "xin1 zeng1 cheng2 yu3", "释义");
    e.set("金瓯无缺", "jin1 ou3 wu2 que1", null);
    e.delete("弹无虚发");
    const text = e.encode();
    expect(text).toBe(
      '{"items":[{"explanation":"释义","kind":"set","pinyin":"xin1 zeng1 cheng2 yu3","word":"新增成语"},' +
        '{"kind":"set","pinyin":"jin1 ou3 wu2 que1","word":"金瓯无缺"},{"kind":"delete","word":"弹无虚发"}]}',
    );
    expect(LexiconEdits.decode(text)?.items).toEqual(e.items);
    expect(LexiconEdits.decode("not json")).toBeNull();
    expect(LexiconEdits.decode("[]")).toBeNull();
    expect(LexiconEdits.decode('{"items":[{"word":"x","kind":"bogus"}]}')).toBeNull();
    expect(LexiconEdits.decode('{"items":[]}')?.isEmpty).toBe(true);
  });
});
