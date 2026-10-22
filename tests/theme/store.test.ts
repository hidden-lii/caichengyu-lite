// 移植自 ThemeSelfTest.swift 的后半（存储：默认值、持久化往返、内置主题保护、损坏恢复、v1 → v2 迁移）。
import { describe, expect, it } from "vitest";
import {
  FILE_NAME,
  ThemeStore,
  type ThemeIO,
  SCALE_RANGE,
  defaultTheme,
  fontChoiceEqual,
  fontFamily,
  fontKaiti,
  fontSongti,
  fontSystem,
  fontsEqual,
  defaultFonts,
  fromHex24,
  materialPalette,
  paletteNamed,
  seedNamed,
  toHexString,
  decodePalette,
  encodePalette,
} from "../../src/theme";

/** 内存里的文件系统 */
function memoryIO(): ThemeIO & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: async (n) => files.get(n) ?? null,
    write: async (n, c) => void files.set(n, c),
    remove: async (n) => void files.delete(n),
    rename: async (from, to) => {
      const v = files.get(from);
      if (v !== undefined) {
        files.set(to, v);
        files.delete(from);
      }
    },
  };
}

const def = defaultTheme.id;
const hex = (c: Parameters<typeof toHexString>[0]): string => toHexString(c);

async function loaded(io: ThemeIO): Promise<ThemeStore> {
  const t = new ThemeStore(io);
  await t.load();
  return t;
}

describe("ThemeStore", () => {
  it("没有文件时是默认外观；内置主题不能被修改；selectMaterial", async () => {
    const io = memoryIO();
    const a = await loaded(io);
    expect(a.palette.value.id).toBe(def);
    expect(fontsEqual(a.fonts.value, defaultFonts())).toBe(true);
    expect(a.customThemes.value).toHaveLength(0);

    a.updateCurrentCustom((p) => void (p.accent = fromHex24(0xff0000)));
    expect(a.palette.value.id).toBe(def);
    expect(hex(a.palette.value.accent)).toBe(hex(defaultTheme.accent));

    a.selectMaterial({ seed: seedNamed("indigo"), dark: true });
    expect(a.selectedID.value).toBe("m-indigo-dark");
    expect(a.palette.value.scheme).toBe("dark");
    a.selectMaterial({ dark: false });
    expect(a.selectedID.value).toBe("m-indigo-light");
    a.select("night");
    a.selectMaterial({ seed: seedNamed("teal") });
    expect(a.selectedID.value).toBe("m-teal-dark"); // 从旧深色主题切到 Material，明暗沿用当前主题
  });

  it("复制 / 编辑 / 持久化往返 / 恢复 / 删除", async () => {
    const io = memoryIO();
    const a = await loaded(io);
    a.select("fresh");
    const custom = a.duplicateCurrent();
    expect(custom.baseID).toBe("fresh");
    expect(custom.name).toBe("清爽 副本");
    expect(a.selectedID.value).toBe(custom.id);
    expect(a.duplicateCurrent().name).toBe("清爽 副本 副本");
    a.select(custom.id);
    a.updateCurrentCustom((p) => {
      p.accent = fromHex24(0x00aa55);
      p.cardRadius = 3;
      p.name = "我的";
    });
    a.updateFonts((f) => {
      f.word = fontKaiti;
      f.ui = fontFamily("Menlo");
      f.scale = 1.1;
    });
    await a.saveNow();

    const b = await loaded(io);
    expect(b.selectedID.value).toBe(custom.id);
    expect(b.palette.value.name).toBe("我的");
    expect(hex(b.palette.value.accent)).toBe("#00AA55FF");
    expect(b.palette.value.cardRadius).toBe(3);
    expect(fontChoiceEqual(b.fonts.value.word, fontKaiti)).toBe(true);
    expect(fontChoiceEqual(b.fonts.value.ui, fontFamily("Menlo"))).toBe(true);
    expect(b.fonts.value.scale).toBe(1.1);
    expect(b.customThemes.value).toHaveLength(2);

    b.resetCurrentCustomToBase();
    expect(hex(b.palette.value.accent)).toBe(hex(paletteNamed("fresh")!.accent));
    expect(b.palette.value.name).toBe("我的");
    expect(b.palette.value.id).toBe(custom.id);

    b.deleteCustom(custom.id);
    expect(b.selectedID.value).toBe(def);
    expect(b.palette.value.id).toBe(def);
    expect(b.customThemes.value).toHaveLength(1);

    b.resetFonts();
    expect(fontsEqual(b.fonts.value, defaultFonts())).toBe(true);
    b.updateFonts((f) => void (f.scale = 5));
    expect(b.fonts.value.scale).toBe(SCALE_RANGE.max);
    b.updateFonts((f) => void (f.scale = 0.1));
    expect(b.fonts.value.scale).toBe(SCALE_RANGE.min);
  });

  it("写盘文件是 v2、键排序、能被 Swift 版同样读回", async () => {
    const io = memoryIO();
    const a = await loaded(io);
    a.select("m-wisteria-dark");
    await a.saveNow();
    const text = io.files.get(FILE_NAME)!;
    const json = JSON.parse(text) as Record<string, unknown>;
    expect(json.version).toBe(2);
    expect(json.selected).toBe("m-wisteria-dark");
    expect(Object.keys(json)).toEqual(["customThemes", "fonts", "selected", "version"]);
    expect(json.fonts).toEqual({ scale: 1, ui: { kind: "system" }, word: { kind: "songti" } });
  });

  it("单个自定义主题损坏不连累其他；选中的主题不存在时回到默认", async () => {
    const io = memoryIO();
    io.files.set(
      FILE_NAME,
      JSON.stringify({
        selected: "gone",
        customThemes: [
          { id: "custom-a", name: "好的", baseID: "ink" },
          { name: "坏的没有id" },
          { id: "desktop", name: "冒充内置" },
        ],
      }),
    );
    const c = await loaded(io);
    expect(c.customThemes.value.map((p) => p.id)).toEqual(["custom-a"]);
    expect(c.selectedID.value).toBe(def);
    expect(fontsEqual(c.fonts.value, defaultFonts())).toBe(true);
  });

  it("整个文件损坏：用默认值，原文件挪成 .bad", async () => {
    const io = memoryIO();
    io.files.set(FILE_NAME, "{ not json");
    const d = await loaded(io);
    expect(d.palette.value.id).toBe(def);
    expect(fontsEqual(d.fonts.value, defaultFonts())).toBe(true);
    expect(d.loadNote.value).not.toBeNull();
    expect(io.files.has(FILE_NAME + ".bad")).toBe(true);
    expect(io.files.has(FILE_NAME)).toBe(false);
  });

  it("缺少必需字段也算损坏（selected / customThemes）", async () => {
    for (const bad of ['{"customThemes":[]}', '{"selected":"x"}', "[]", '{"selected":"x","customThemes":[],"version":"2"}']) {
      const io = memoryIO();
      io.files.set(FILE_NAME, bad);
      const t = await loaded(io);
      expect(t.loadNote.value).not.toBeNull();
      expect(io.files.has(FILE_NAME + ".bad")).toBe(true);
    }
  });

  it("v1 → v2 迁移", async () => {
    const io = memoryIO();
    const write = (json: string): void => void io.files.set(FILE_NAME, json);

    write('{"version":1,"selected":"ink","fonts":{"scale":1,"ui":{"kind":"songti"},"word":{"kind":"songti"}},"customThemes":[]}');
    const m1 = await loaded(io);
    expect(m1.selectedID.value).toBe(def);
    expect(fontChoiceEqual(m1.fonts.value.ui, fontSystem)).toBe(true);
    expect(fontChoiceEqual(m1.fonts.value.word, fontSongti)).toBe(true);
    await m1.saveNow();
    const m1b = await loaded(io);
    expect(m1b.selectedID.value).toBe(def);
    expect(fontChoiceEqual(m1b.fonts.value.ui, fontSystem)).toBe(true);
    expect(JSON.parse(io.files.get(FILE_NAME)!).version).toBe(2);

    write('{"version":1,"selected":"custom-k","fonts":{"scale":1.1,"ui":{"kind":"kaiti"},"word":{"kind":"kaiti"}},"customThemes":[{"id":"custom-k","name":"我的","baseID":"ink"}]}');
    const m2 = await loaded(io);
    expect(m2.selectedID.value).toBe("custom-k");
    expect(fontChoiceEqual(m2.fonts.value.ui, fontKaiti)).toBe(true);
    expect(m2.fonts.value.scale).toBe(1.1);

    write('{"version":2,"selected":"night","fonts":{"scale":1,"ui":{"kind":"songti"},"word":{"kind":"songti"}},"customThemes":[]}');
    const m3 = await loaded(io);
    expect(m3.selectedID.value).toBe("night");
    expect(fontChoiceEqual(m3.fonts.value.ui, fontSongti)).toBe(true);

    write('{"selected":"m-wisteria-dark","fonts":{"scale":1,"ui":{"kind":"system"},"word":{"kind":"kaiti"}},"customThemes":[]}');
    const m4 = await loaded(io);
    expect(m4.selectedID.value).toBe("m-wisteria-dark");
    expect(m4.palette.value.scheme).toBe("dark");
    expect(fontChoiceEqual(m4.fonts.value.word, fontKaiti)).toBe(true);

    // 自定义主题基于 Material 主题：Material 标记与扩展色沿用基底，往返后仍保持
    m4.select("m-wisteria-dark");
    const cm = m4.duplicateCurrent();
    const base = materialPalette(seedNamed("wisteria")!, true);
    expect(cm.isMaterial).toBe(true);
    expect(cm.baseID).toBe("m-wisteria-dark");
    expect(hex(cm.extras.tonal!)).toBe(hex(base.extras.tonal!));
    const back = decodePalette(JSON.parse(JSON.stringify(encodePalette(cm))))!;
    expect(back.isMaterial).toBe(true);
    expect(hex(back.extras.tonal!)).toBe(hex(cm.extras.tonal!));
  });

  it("预览 / 临时覆盖不改选中项也不写盘", async () => {
    const io = memoryIO();
    const a = await loaded(io);
    a.select("night", false);
    expect(a.palette.value.id).toBe("night");
    expect(a.selectedID.value).toBe(def);
    await a.flush();
    expect(io.files.has(FILE_NAME)).toBe(false);
  });

  it("改动后合并写盘（防抖）", async () => {
    const io = memoryIO();
    const a = await loaded(io);
    a.select("night");
    expect(io.files.has(FILE_NAME)).toBe(false);
    await a.flush(); // 有待写的改动 → 立刻写出
    expect(JSON.parse(io.files.get(FILE_NAME)!).selected).toBe("night");
  });
});
