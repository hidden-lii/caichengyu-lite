// LexiconStore 测试。用合成的小词库 + 临时目录，快且可控；
// 另有一个用真实烘焙产物测「默认全选合并」耗时的用例。对应 Swift `LexiconStoreTests.swift`
// （没有移植缓存相关的用例：这个版本不做磁盘缓存，见 store.ts 文件头注释）。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LexiconBaker, LexiconCatalog } from "../../src/core/lexicon/catalog";
import { IdiomTable } from "../../src/core/lexicon/idiomTable";
import { LexiconStore } from "../../src/core/lexicon/store";
import { LexiconEdits } from "../../src/core/lexicon/catalog";
import { LexiconStoreError, type LexiconSnapshot } from "../../src/core/lexicon/types";
import { FsDataIO } from "./support/fsIO";

const wordPool: readonly (readonly [string, string])[] = [
  ["一心一意", "yī xīn yī yì"],
  ["金瓯无缺", "jīn ōu wú quē"],
  ["弹无虚发", "dàn wú xū fā"],
  ["国不堪贰", "guó bù kān èr"],
  ["画蛇添足", "huà shé tiān zú"],
  ["守株待兔", "shǒu zhū dài tù"],
  ["亡羊补牢", "wáng yáng bǔ láo"],
  ["掩耳盗铃", "yǎn ěr dào líng"],
];

/** 每个内置来源收哪几个词（下标指向 wordPool）。优先级顺序见 `LexiconCatalog`。 */
const sourceWords: Record<string, number[]> = {
  hanyuguoxue: [0, 1, 2],
  zdic: [1, 2, 3],
  hwxnet: [2, 3, 4],
  baidu: [3, 4, 5],
  chinesewords: [4, 5, 6],
  xinhua: [5, 6, 7],
  toollu: [0, 7],
  moe: [1, 7],
  merged: [0, 1, 2, 3, 4, 5, 6, 7],
};

/** 临时的 bundleRoot + 用户数据目录。bundleRoot/lexicon 里有 9 个合成 .idx 与一份小 polyphones.json。 */
class Fixture {
  readonly root = mkdtempSync(join(tmpdir(), "lexstore-"));
  readonly bundleRoot = join(this.root, "bundle");
  readonly supportRoot = join(this.root, "support");
  readonly io: FsDataIO;

  constructor() {
    mkdirSync(join(this.bundleRoot, "lexicon"), { recursive: true });
    mkdirSync(this.supportRoot, { recursive: true });
    for (const lex of LexiconCatalog.all) {
      const items = (sourceWords[lex.id] ?? []).map((i) => ({
        word: wordPool[i][0],
        pinyin: wordPool[i][1],
        explanation: `${lex.id}释义${i}`,
      }));
      if (lex.id === "xinhua") items.push({ word: "无效读音", pinyin: "wu2", explanation: "" }); // 读音无效 → 合并时丢弃
      this.writeBundle(`lexicon/${lex.bakedFile}`, LexiconBaker.bake(items).builder.serialize());
    }
    this.writeBundle(
      "lexicon/polyphones.json",
      new TextEncoder().encode('{"行":{"default":"xíng","alts":["háng"]},"长":{"default":"cháng","alts":["zhǎng"]}}'),
    );
    this.io = new FsDataIO(this.supportRoot, this.bundleRoot);
  }

  writeBundle(path: string, bytes: Uint8Array): void {
    writeFileSync(join(this.bundleRoot, path), bytes);
  }

  store(io: FsDataIO = this.io): LexiconStore {
    return new LexiconStore({ io });
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }
}

const fixtures: Fixture[] = [];
function fixture(): Fixture {
  const fx = new Fixture();
  fixtures.push(fx);
  return fx;
}
afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.dispose();
});

const words = (t: IdiomTable): string[] => Array.from({ length: t.count }, (_, i) => t.word(i));

describe("LexiconStore · 加载", () => {
  it("首次加载：合并默认全选，统计与计数正确", async () => {
    const fx = fixture();
    const store = fx.store();
    const { snapshot: snap1, report: rep1 } = await store.load();
    expect(rep1.fromCache).toBe(false);
    expect(rep1.builtStages).toEqual(["stage1"]);
    expect(snap1.generation).toBe(1);
    expect(snap1.sources).toEqual(LexiconCatalog.defaultSelection);
    expect(snap1.skipped).toBe(1); // 「无效读音」
    expect(snap1.count).toBe(8);
    expect(snap1.polyMap.size).toBe(2);
    const c = store.counters();
    expect(c.merges).toBe(1);
    expect(c.sourceOpens).toBe(9);
    expect(store.currentSnapshot()).toBe(snap1);
  });

  it("同一个 store 再次 load 返回当前快照", async () => {
    const fx = fixture();
    const store = fx.store();
    const { snapshot: a } = await store.load();
    const { snapshot: b, report } = await store.load();
    expect(b).toBe(a);
    expect(report.fromCache).toBe(true);
    expect(report.builtStages).toEqual([]);
    expect(store.counters().merges).toBe(1);
  });

  it("进度回调是中文短句", async () => {
    const fx = fixture();
    const log: string[] = [];
    await fx.store().load((m) => log.push(m));
    expect(log).toContain("正在载入词库…");
    expect(log).toContain("正在读取词库…");
    expect(log).toContain("正在合并词库…");
  });

  it("随包资源缺失时报 sourceUnavailable，之后换个不含它的来源仍可用", async () => {
    const fx = fixture();
    fx.io.bundledMissing.add("lexicon/moe.idx");
    const store = fx.store();
    let error: unknown = null;
    try {
      await store.load();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(LexiconStoreError);
    expect((error as LexiconStoreError).kind).toBe("sourceUnavailable");
    expect((error as LexiconStoreError).id).toBe("moe");
    // 失败之后换个不含它的来源仍可用
    const ok = await store.applySources(["xinhua"]);
    expect(ok.snapshot.sources).toEqual(["xinhua"]);
  });

  it("源文件损坏（校验失败）同样报 sourceUnavailable", async () => {
    const fx = fixture();
    fx.io.bundledOverride.set("lexicon/zdic.idx", new Uint8Array(4096).fill(7));
    let error: unknown = null;
    try {
      await fx.store().load();
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(LexiconStoreError);
    expect((error as LexiconStoreError).id).toBe("zdic");
  });

  it("多音字表可注入路径；缺失时降级为空表而不是让加载失败", async () => {
    const fx = fixture();
    fx.writeBundle(
      "elsewhere.json",
      new TextEncoder().encode('{"重":{"default":"zhòng","alts":["chóng"]}}'),
    );
    fx.io.bundledMissing.add("lexicon/polyphones.json");
    const store = new LexiconStore({ io: fx.io, polyphonesPath: "elsewhere.json" });
    const { snapshot } = await store.load();
    expect(Array.from(snapshot.polyMap.keys())).toEqual(["重"]);
    // 缺失时降级为空表，不应让加载失败
    const none = new LexiconStore({ io: fx.io });
    const { snapshot: snap2 } = await none.load();
    expect(snap2.polyMap.size).toBe(0);
  });
});

describe("LexiconStore · 来源选择", () => {
  it("切换来源并持久化；重启后沿用", async () => {
    const fx = fixture();
    const a = fx.store();
    await a.load();
    const r = await a.applySources(["moe", "toollu"]);
    expect(r.report.builtStages).toEqual(["stage1"]);
    expect(r.snapshot.sources).toEqual(["moe", "toollu"]);
    expect(r.snapshot.generation).toBe(2);
    expect(r.snapshot.count).toBe(3); // 金瓯无缺 / 掩耳盗铃 / 一心一意
    expect(new Set(words(r.snapshot.table))).toEqual(new Set(["金瓯无缺", "掩耳盗铃", "一心一意"]));
    expect(r.outcome.added).toBe(3);

    // 重启后沿用所选来源
    const b = fx.store();
    expect(await b.selectedSources()).toEqual(["moe", "toollu"]);
    const { snapshot } = await b.load();
    expect(snapshot.sources).toEqual(["moe", "toollu"]);
    expect(snapshot.count).toBe(3);
  });

  it("所选顺序即优先级", async () => {
    const fx = fixture();
    // 一心一意：hanyuguoxue 与 toollu 的释义不同；谁在前，谁的释义胜出
    const a = fx.store();
    await a.load();
    const r1 = await a.applySources(["hanyuguoxue", "toollu"]);
    const row1 = r1.snapshot.table.rowForWord("一心一意") as number;
    expect(r1.snapshot.table.explanation(row1)).toBe("hanyuguoxue释义0");
    const r2 = await a.applySources(["toollu", "hanyuguoxue"]);
    const row2 = r2.snapshot.table.rowForWord("一心一意") as number;
    expect(r2.snapshot.table.explanation(row2)).toBe("toollu释义0");
    expect(r2.snapshot.sources).toEqual(["toollu", "hanyuguoxue"]);
  });

  it("重复应用同一组来源：不重做任何阶段，但代数递增", async () => {
    const fx = fixture();
    const a = fx.store();
    await a.load();
    const r = await a.applySources(LexiconCatalog.defaultSelection);
    expect(r.report.fromCache).toBe(true);
    expect(r.report.builtStages).toEqual([]);
    expect(r.snapshot.generation).toBe(2);
    expect(a.counters().merges).toBe(1);
  });

  it("settings.json 的默认值与清洗", async () => {
    const fx = fixture();
    expect(await fx.store().selectedSources()).toEqual(LexiconCatalog.defaultSelection);

    await fx.io.writeData("settings.json", '["moe","nope","moe","zdic"]');
    expect(await fx.store().selectedSources()).toEqual(["moe", "zdic"]); // 未知 id 丢弃、去重、保序

    await fx.io.writeData("settings.json", '["nope","also-nope"]');
    expect(await fx.store().selectedSources()).toEqual(LexiconCatalog.defaultSelection); // 丢光则回到默认

    await fx.io.writeData("settings.json", "garbage");
    expect(await fx.store().selectedSources()).toEqual(LexiconCatalog.defaultSelection);

    await fx.io.writeData("settings.json", '{"a":1}');
    expect(await fx.store().selectedSources()).toEqual(LexiconCatalog.defaultSelection);
  });

  it("至少选一个来源", async () => {
    const fx = fixture();
    const store = fx.store();
    await store.load();
    for (const ids of [[], ["nope"]]) {
      let error: unknown = null;
      try {
        await store.applySources(ids);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(LexiconStoreError);
      expect((error as LexiconStoreError).kind).toBe("noSourceSelected");
      expect((error as Error).message).toBe("请至少选择一个内置词库");
    }
    expect(await store.selectedSources()).toEqual(LexiconCatalog.defaultSelection); // 失败不应改动所选来源
    expect(store.currentSnapshot()?.generation).toBe(1);
  });

  it("应用失败保持原状（不写 settings.json）", async () => {
    const fx = fixture();
    const store = fx.store();
    await store.load();
    fx.io.bundledMissing.add("lexicon/moe.idx");
    await expect(store.applySources(["moe"])).rejects.toBeInstanceOf(LexiconStoreError);
    expect(await store.selectedSources()).toEqual(LexiconCatalog.defaultSelection);
    expect(await fx.io.readData("settings.json")).toBeNull();
    expect(store.currentSnapshot()?.generation).toBe(1);
  });
});

describe("LexiconStore · 用户改动", () => {
  it("新增 / 更新 / 删除的语义", async () => {
    const fx = fixture();
    const store = fx.store();
    const { snapshot: base } = await store.load();
    expect(base.generation).toBe(1);

    // 新增
    const add = await store.addIdiom(" 新增成语 ", "xin1 zeng1 cheng2 yu3", " 新释义 ");
    expect(add.outcome).toEqual({ added: 1, updated: 0, skipped: 0, deleted: 0, errors: [] });
    expect(add.snapshot.generation).toBe(2);
    expect(add.snapshot.count).toBe(base.count + 1);
    const row = add.snapshot.table.rowForWord("新增成语") as number;
    expect(add.snapshot.table.pinyin(row)).toBe("xīn zēng chéng yǔ");
    expect(add.snapshot.table.explanation(row)).toBe("新释义");
    expect(row, "新增追加到末尾").toBe(base.count);
    expect(add.report.builtStages).toEqual(["final"]);

    // 已存在 → 更新读音与释义（释义被替换，哪怕传空）
    const up = await store.addIdiom("一心一意", "yi4 xin1 yi1 yi4", "");
    expect(up.outcome).toEqual({ added: 0, updated: 1, skipped: 0, deleted: 0, errors: [] });
    const r1 = up.snapshot.table.rowForWord("一心一意") as number;
    expect(up.snapshot.table.pinyin(r1)).toBe("yì xīn yī yì");
    expect(up.snapshot.table.explanation(r1)).toBe("");
    expect(up.snapshot.count).toBe(base.count + 1);
    expect(up.snapshot.generation).toBe(3);

    // 音节数不符 / 空
    const bad = await store.addIdiom("坏词条目", "huai4 ci2", "");
    expect(bad.outcome.skipped).toBe(1);
    expect(bad.outcome.errors).toEqual(["「坏词条目」拼音音节数与字数不一致"]);
    expect(bad.snapshot.generation, "失败不递增").toBe(3);
    const empty = await store.addIdiom("  ", "", "");
    expect(empty.outcome.skipped).toBe(1);
    expect(empty.outcome.errors).toEqual(["存在无效条目（缺少 word 或 pinyin）"]);

    // 删除
    const del = await store.deleteIdiom("金瓯无缺");
    expect(del.outcome.deleted).toBe(1);
    expect(del.snapshot.table.rowForWord("金瓯无缺")).toBeNull();
    expect(del.snapshot.generation).toBe(4);
    const delAgain = await store.deleteIdiom("金瓯无缺");
    expect(delAgain.outcome.deleted).toBe(0);
    expect(delAgain.outcome.errors).toEqual(["词库中不存在「金瓯无缺」"]);
    expect(delAgain.snapshot.generation).toBe(4);
  });

  it("updatePinyin 保留释义、不重新合并、原位替换", async () => {
    const fx = fixture();
    const store = fx.store();
    const { snapshot: base } = await store.load();
    expect(store.counters().merges).toBe(1);

    const r = await store.updatePinyin("金瓯无缺", "jin1 ou3 wu2 que1");
    expect(r.outcome).toEqual({ added: 0, updated: 1, skipped: 0, deleted: 0, errors: [] });
    const row = r.snapshot.table.rowForWord("金瓯无缺") as number;
    expect(r.snapshot.table.pinyin(row)).toBe("jīn ǒu wú quē");
    const baseRow = base.table.rowForWord("金瓯无缺") as number;
    expect(r.snapshot.table.explanation(row), "保留释义").toBe(base.table.explanation(baseRow));
    expect(row, "原位替换，不改变候选顺序").toBe(baseRow);
    expect(r.report.builtStages, "只重做 final").toEqual(["final"]);
    expect(r.report.fromCache).toBe(false);

    // 连续再改一次，不应触发合并或重新打开源 .idx
    const opensBefore = store.counters().sourceOpens;
    await store.updatePinyin("弹无虚发", "dan4 wu2 xu1 fa1");
    expect(store.counters().merges).toBe(1);
    expect(store.counters().sourceOpens).toBe(opensBefore);

    // 重启后的新实例：load 合并一次，之后再改仍只重做 final
    const fresh = fx.store();
    const { report } = await fresh.load();
    expect(report.builtStages).toEqual(["stage1", "final"]);
    const again = await fresh.updatePinyin("国不堪贰", "guo2 bu4 kan1 er4");
    expect(again.report.builtStages).toEqual(["final"]);
    expect(again.snapshot.table.rowForWord("金瓯无缺")).not.toBeNull();
    expect(fresh.counters().merges).toBe(1);
  });

  it("updatePinyin 的错误情形不留痕迹", async () => {
    const fx = fixture();
    const store = fx.store();
    await store.load();
    const missing = await store.updatePinyin("不存在词", "bu4 cun2 zai4 ci2");
    expect(missing.outcome.skipped).toBe(1);
    expect(missing.outcome.errors).toEqual(["词库中不存在「不存在词」"]);
    const badCount = await store.updatePinyin("金瓯无缺", "jin1 ou3");
    expect(badCount.outcome.errors).toEqual(["「金瓯无缺」拼音音节数与字数不一致"]);
    const blank = await store.updatePinyin("金瓯无缺", "  ");
    expect(blank.outcome.errors).toEqual(["成语或拼音不能为空"]);
    expect(blank.snapshot.generation).toBe(1);
    expect(await fx.io.readData("edits.json")).toBeNull();
  });

  it("改动在重启与切换来源之后继续生效", async () => {
    const fx = fixture();
    const a = fx.store();
    await a.load();
    await a.addIdiom("新增成语", "xin1 zeng1 cheng2 yu3", "新释义");
    await a.updatePinyin("一心一意", "yi4 xin1 yi1 yi4");
    await a.deleteIdiom("金瓯无缺");

    // 重启：改动仍在
    const b = fx.store();
    const { snapshot: snap } = await b.load();
    expect(snap.table.rowForWord("金瓯无缺")).toBeNull();
    expect(snap.table.pinyin(snap.table.rowForWord("一心一意") as number)).toBe("yì xīn yī yì");
    expect(snap.table.explanation(snap.table.rowForWord("新增成语") as number)).toBe("新释义");

    // 切换来源：改动继续生效
    const sw = await b.applySources(["hanyuguoxue", "zdic"]);
    expect(sw.report.builtStages).toEqual(["stage1", "final"]);
    const t = sw.snapshot.table;
    expect(t.rowForWord("金瓯无缺"), "删除继续生效").toBeNull();
    expect(t.pinyin(t.rowForWord("一心一意") as number), "改读音继续生效").toBe("yì xīn yī yì");
    expect(t.rowForWord("新增成语"), "新增继续生效").not.toBeNull();
    expect(t.rowForWord("弹无虚发")).not.toBeNull();

    // 再重启，结果一致
    const c = fx.store();
    const { snapshot: snap3 } = await c.load();
    expect(words(snap3.table)).toEqual(words(t));
  });

  it("撤销全部改动后回到纯合并结果", async () => {
    const fx = fixture();
    const store = fx.store();
    await store.load();
    await store.addIdiom("新增成语", "xin1 zeng1 cheng2 yu3", "");
    // 删除纯用户新增的词 = 撤销那条新增 → 回到无改动
    const del = await store.deleteIdiom("新增成语");
    expect(del.outcome.deleted).toBe(1);
    expect(del.snapshot.count).toBe(8);
    const { snapshot, report } = await fx.store().load();
    expect(report.builtStages).toEqual(["stage1"]); // 无改动：不需要 final
    expect(snapshot.count).toBe(8);
    const saved = LexiconEdits.decode((await fx.io.readData("edits.json")) ?? "");
    expect(saved?.items.length).toBe(0);
  });

  it("损坏的 edits.json 改名留档，按无改动处理", async () => {
    const fx = fixture();
    await fx.io.writeData("edits.json", "not json");
    const { snapshot } = await fx.store().load();
    expect(snapshot.count).toBe(8);
    expect(await fx.io.readData("edits.corrupt.json")).toBe("not json");
    expect(await fx.io.readData("edits.json")).toBeNull();
    // 已有同名留档时被覆盖
    await fx.io.writeData("edits.json", "{oops");
    await fx.store().load();
    expect(await fx.io.readData("edits.corrupt.json")).toBe("{oops");
  });

  it("edits.json 与 Swift 版格式互通", async () => {
    const fx = fixture();
    // Swift JSONEncoder(.sortedKeys) 的输出
    await fx.io.writeData(
      "edits.json",
      '{"items":[{"explanation":"来自 Swift","kind":"set","pinyin":"xin1 zeng1 cheng2 yu3","word":"新增成语"},{"kind":"delete","word":"金瓯无缺"}]}',
    );
    const { snapshot } = await fx.store().load();
    expect(snapshot.table.explanation(snapshot.table.rowForWord("新增成语") as number)).toBe("来自 Swift");
    expect(snapshot.table.rowForWord("金瓯无缺")).toBeNull();
  });
});

describe("LexiconStore · 并发", () => {
  it("并发变更被串行化：代数唯一连续，没有丢失", async () => {
    const fx = fixture();
    const store = fx.store();
    const { snapshot: base } = await store.load();

    const word = (i: number): string =>
      String.fromCodePoint(0x4e00 + i * 4, 0x4e00 + i * 4 + 1, 0x4e00 + i * 4 + 2, 0x4e00 + i * 4 + 3);
    const adds = 30;
    const jobs: Promise<{ outcome: { added: number; updated: number; deleted: number }; snapshot: LexiconSnapshot }>[] = [];
    for (let i = 0; i < adds; i++) jobs.push(store.addIdiom(word(i), "yi1 er4 san1 si4", `并发${i}`));
    ["一心一意", "弹无虚发", "国不堪贰"].forEach((w, j) => jobs.push(store.updatePinyin(w, `ba1 ba1 ba1 ba${j + 1}`)));
    ["画蛇添足", "守株待兔"].forEach((w) => jobs.push(store.deleteIdiom(w)));
    const results = await Promise.all(jobs);

    expect(results.length).toBe(adds + 5);
    expect(results.every((r) => r.outcome.added + r.outcome.updated + r.outcome.deleted > 0)).toBe(true);
    // 每次变更都得到唯一且连续的 generation（没有交错 / 丢失）
    const gens = results.map((r) => r.snapshot.generation).sort((a, b) => a - b);
    expect(gens).toEqual(Array.from({ length: adds + 5 }, (_, i) => base.generation + 1 + i));

    const final = store.currentSnapshot() as LexiconSnapshot;
    expect(final.count).toBe(base.count + adds - 2);
    for (let i = 0; i < adds; i++) expect(final.table.rowForWord(word(i)), `第 ${i} 个新增丢失`).not.toBeNull();
    expect(final.table.rowForWord("画蛇添足")).toBeNull();
    expect(final.table.rowForWord("守株待兔")).toBeNull();
    expect(final.table.pinyin(final.table.rowForWord("国不堪贰") as number)).toBe("bā bā bā bǎ");

    // 持久化的结果与内存一致
    const { snapshot: reloaded } = await fx.store().load();
    expect(words(reloaded.table)).toEqual(words(final.table));
  });

  it("并发的首次加载只合并一次", async () => {
    const fx = fixture();
    const store = fx.store();
    const snaps = await Promise.all(Array.from({ length: 8 }, () => store.load()));
    expect(new Set(snaps.map((s) => s.snapshot.generation))).toEqual(new Set([1]));
    expect(store.counters().merges).toBe(1);
  });

  it("前一个操作失败不会卡住队列", async () => {
    const fx = fixture();
    const store = fx.store();
    await store.load();
    const bad = store.applySources([]);
    const good = store.addIdiom("新增成语", "xin1 zeng1 cheng2 yu3", "");
    await expect(bad).rejects.toBeInstanceOf(LexiconStoreError);
    expect((await good).outcome.added).toBe(1);
  });
});

describe("LexiconStore · 真实资源", () => {
  it("默认全选合并：条数、耗时、多音表", async () => {
    const io = new FsDataIO();
    try {
      const store = new LexiconStore({ io });
      const t0 = performance.now();
      const { snapshot, report } = await store.load();
      const wall = performance.now() - t0;
      expect(report.builtStages).toEqual(["stage1"]);
      expect(snapshot.count).toBe(66289);
      expect(snapshot.skipped).toBeGreaterThan(0);
      expect(snapshot.polyMap.size).toBeGreaterThan(100);
      expect(snapshot.table.rowForWord("一心一意")).not.toBeNull();
      expect(snapshot.sources).toEqual(LexiconCatalog.defaultSelection);
      console.log(
        `[LexiconStore] 真实词库 ${snapshot.count} 条 · 跳过 ${snapshot.skipped} · 多音字 ${snapshot.polyMap.size} · ` +
          `默认全选合并加载 ${report.durationMs} ms（墙钟 ${wall.toFixed(0)} ms，含读文件）`,
      );
      expect(wall, "目标：WKWebView 里 < 1.5s；Node 里应远低于此").toBeLessThan(1500);

      // 新增一个词并重启：改动持久化、重启后合并 + 应用改动
      const add = await store.addIdiom("龘龘龘龘", "da2 da2 da2 da2", "测试");
      expect(add.outcome.added).toBe(1);
      const t1 = performance.now();
      const { snapshot: again, report: rep2 } = await new LexiconStore({ io }).load();
      console.log(`[LexiconStore] 带改动的重启加载 ${rep2.durationMs} ms（墙钟 ${(performance.now() - t1).toFixed(0)} ms）`);
      expect(rep2.builtStages).toEqual(["stage1", "final"]);
      expect(again.count).toBe(66290);
      expect(again.table.explanation(again.table.rowForWord("龘龘龘龘") as number)).toBe("测试");
    } finally {
      io.dispose();
    }
  });
});
