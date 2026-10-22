// 移植自 ThemeSelfTest.swift 的前半（颜色、内置主题、编码、字体）：同一组期望值。
import { describe, expect, it } from "vitest";
import {
  CLEAR,
  WHITE,
  builtinPalettes,
  colorFields,
  decodeFontSettings,
  decodePalette,
  defaultFonts,
  defaultTheme,
  encodePalette,
  fontFamily,
  fontFromTag,
  fontKaiti,
  fontRounded,
  fontSongti,
  fontSystem,
  fontTag,
  fromHex24,
  legacyPalettes,
  materialPalette,
  materialPalettes,
  materialSeeds,
  materialTone,
  paletteNamed,
  parseHexString,
  parseMaterialID,
  rgba,
  seedNamed,
  surfaceHigh,
  toHexString,
  SCALE_RANGE,
  RADIUS_RANGE,
  SHADOW_RANGE,
  fontChoiceEqual,
  isBuiltin,
  type Palette,
} from "../../src/theme";

const hex = (c: { r: number; g: number; b: number; a: number }): string => toHexString(c);
/** 亮度（HSB 的 brightness = max(r,g,b)，同 NSColor.brightnessComponent） */
const brightness = (c: { r: number; g: number; b: number }): number => Math.max(c.r, c.g, c.b);

describe("颜色 ⇄ 十六进制", () => {
  it("往返（含完全透明、半透明）", () => {
    for (const c of [WHITE, CLEAR, fromHex24(0xb84a2f), fromHex24(0x123456, 0.5)]) {
      const h = toHexString(c);
      const back = parseHexString(h);
      expect(back && toHexString(back)).toBe(h);
    }
  });
  it("非法输入", () => {
    expect(parseHexString("#12345")).toBeNull();
    expect(parseHexString("zzzzzz")).toBeNull();
    expect(parseHexString("336699") && toHexString(parseHexString("336699")!)).toBe("#336699FF");
  });
  it("白 / 透明的落盘形态", () => {
    expect(toHexString(WHITE)).toBe("#FFFFFFFF");
    expect(toHexString(CLEAR)).toBe("#00000000");
  });
});

describe("内置主题", () => {
  it("id 唯一，默认主题是第一套", () => {
    expect(new Set(builtinPalettes.map((p) => p.id)).size).toBe(builtinPalettes.length);
    expect(defaultTheme.id).toBe("m-cinnabar-light");
    expect(builtinPalettes[0]!.id).toBe(defaultTheme.id);
  });
  it("10 套 Material + 5 套旧主题，旧主题仍可用", () => {
    expect(materialPalettes.length).toBe(materialSeeds.length * 2);
    expect(legacyPalettes.length).toBe(5);
    expect(paletteNamed("desktop")).toBeDefined();
    expect(paletteNamed("ink")).toBeDefined();
  });
  it("Material 主题的标记 / id / 明暗一致", () => {
    for (const m of materialPalettes) {
      const parsed = parseMaterialID(m.id);
      expect(m.isMaterial && m.capsuleButtons && parsed !== null).toBe(true);
      expect(m.scheme).toBe(parsed!.dark ? "dark" : "light");
    }
  });
  it("parseMaterialID", () => {
    const t = parseMaterialID("m-teal-dark");
    expect(t?.seed.id).toBe("teal");
    expect(t?.dark).toBe(true);
    expect(parseMaterialID("m-nope-dark")).toBeNull();
    expect(parseMaterialID("desktop")).toBeNull();
  });
  it("色调 0 / 100 是黑 / 白", () => {
    expect(hex(materialTone(38, 0.15, 100))).toBe("#FFFFFFFF");
    expect(hex(materialTone(38, 0.15, 0))).toBe("#000000FF");
  });
  it("明暗：浅色 primary 比深色暗；表面层级方向相反", () => {
    const lp = materialPalette(seedNamed("cinnabar")!, false);
    const dp = materialPalette(seedNamed("cinnabar")!, true);
    expect(brightness(lp.accent)).toBeLessThan(brightness(dp.accent));
    expect(brightness(surfaceHigh(lp))).toBeLessThan(brightness(lp.field));
    expect(brightness(surfaceHigh(dp))).toBeGreaterThan(brightness(dp.field));
  });
  it("编码往返后落盘形态不变", () => {
    for (const p of builtinPalettes) {
      const json = encodePalette(p);
      const back = decodePalette(JSON.parse(JSON.stringify(json)));
      expect(back && encodePalette(back)).toEqual(json);
    }
  });
  it("颜色字段表 32 个且 key 唯一", () => {
    expect(colorFields.length).toBe(32);
    expect(new Set(colorFields.map((f) => f.key)).size).toBe(colorFields.length);
  });
});

describe("缺字段 / 坏字段", () => {
  it("回落到所基于的内置主题，数值夹到合法范围", () => {
    const sparse = {
      id: "custom-x", name: "稀疏", baseID: "night", accent: "#112233", hit: "not-a-color",
      cardRadius: 999, shadowOpacity: -3, scheme: "light",
    };
    const p = decodePalette(sparse) as Palette;
    expect(p).not.toBeNull();
    const night = paletteNamed("night")!;
    expect(hex(p.accent)).toBe("#112233FF");
    expect(hex(p.hit)).toBe(hex(night.hit));
    expect(hex(p.bgMid)).toBe(hex(night.bgMid));
    expect(p.cardRadius).toBe(RADIUS_RANGE.max);
    expect(p.shadowOpacity).toBe(SHADOW_RANGE.min);
    expect(p.scheme).toBe("light");
    expect(p.baseID).toBe("night");
    expect(p.name).toBe("稀疏");
  });
  it("没有 id 的主题解码失败", () => {
    expect(decodePalette({ name: "没有id" })).toBeNull();
    expect(decodePalette("x")).toBeNull();
  });
  it("基于 Material 的自定义主题保留 Material 标记与扩展色", () => {
    const base = paletteNamed("m-wisteria-dark")!;
    const p = decodePalette({ id: "custom-m", baseID: "m-wisteria-dark" })!;
    expect(p.isMaterial).toBe(true);
    expect(hex(p.extras.tonal!)).toBe(hex(base.extras.tonal!));
    expect(isBuiltin(p)).toBe(false);
  });
});

describe("字体", () => {
  it("默认：界面系统字体、成语字头宋体、不缩放", () => {
    const f = defaultFonts();
    expect(fontChoiceEqual(f.ui, fontSystem)).toBe(true);
    expect(fontChoiceEqual(f.word, fontSongti)).toBe(true);
    expect(f.scale).toBe(1);
  });
  it("tag 往返；非法 tag 被拒绝", () => {
    for (const c of [fontSongti, fontKaiti, fontSystem, fontRounded, fontFamily("PingFang SC")]) {
      const back = fontFromTag(fontTag(c));
      expect(back && fontChoiceEqual(back, c)).toBe(true);
    }
    expect(fontFromTag("family:")).toBeNull();
    expect(fontFromTag("bogus")).toBeNull();
    expect(fontFromTag("family")).toBeNull();
  });
  it("含坏字段的字体设置：字号夹到上限、未知种类回落到系统字体", () => {
    const f = decodeFontSettings({ scale: 9, ui: { kind: "nope" } })!;
    expect(f.scale).toBe(SCALE_RANGE.max);
    expect(fontChoiceEqual(f.ui, fontSystem)).toBe(true);
    expect(fontChoiceEqual(f.word, fontSongti)).toBe(true);
  });
});

describe("OKLCH → sRGB 数值", () => {
  // 期望值由 Swift 实现的同一算法给出：浅色 N(98) 近乎中性灰，P(40) 为朱砂
  it("中性灰阶", () => {
    expect(hex(materialTone(38, 0.009, 98)).slice(0, 7)).toMatch(/^#F[89A]F[89A]F[89A]$/);
  });
  it("自定义 rgba", () => {
    expect(toHexString(rgba(0.5, 0.25, 1, 0.5))).toBe("#8040FF80");
  });
});
