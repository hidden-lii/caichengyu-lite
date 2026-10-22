// 视觉主题的数据：Palette（颜色 + 形状）、Material 主题色与配色生成、旧主题、可编辑颜色字段表、编码 / 解码。
//
// 移植自 Theme.swift（Palette / MaterialExtras / 内置调色板）、MaterialColor.swift（MaterialSeed / MaterialRoles / 生成 Palette）、
// ThemeStore.swift（colorFields / Codable）。数值与 Swift 完全一致，单测见 tests/theme。

import { blended, CLEAR, fromHex24, type RGBA, parseHexString, toHexString, WHITE, colorsEqual } from "./color";
import { materialTone } from "./oklch";

export type ChipStyle = "solid" | "solidOutlined";
export type StatusStyle = "pill" | "plain";
export type Scheme = "light" | "dark";

export const CHIP_STYLES: readonly ChipStyle[] = ["solid", "solidOutlined"];
export const STATUS_STYLES: readonly StatusStyle[] = ["pill", "plain"];

/** Material 3 才有的几个角色色。全部可选，缺省时由基础色推导（见 `surfaceLow` 等函数）。 */
export interface MaterialExtras {
  surfaceLow?: RGBA;
  surfaceHigh?: RGBA;
  surfaceHighest?: RGBA;
  tonal?: RGBA;
  onTonal?: RGBA;
  outline?: RGBA;
  onAccentSoft?: RGBA;
  inverseSurface?: RGBA;
  inverseOnSurface?: RGBA;
  inversePrimary?: RGBA;
}

/** 所有「可编辑的颜色」字段（= Swift `Palette.colorFields` 的 key）。 */
export type ColorKey =
  | "bgTop" | "bgMid" | "bgBottom" | "surface" | "stage" | "field" | "border"
  | "ink" | "muted" | "accent" | "accentSoft" | "onAccent" | "secondary"
  | "ok" | "warn" | "danger"
  | "statusOkBg" | "statusOkBorder" | "statusWarnBg" | "statusWarnBorder"
  | "nodeIdle" | "hit" | "present" | "absent" | "onMark"
  | "hitAuto" | "hitAutoInk" | "presentAuto" | "presentAutoInk" | "absentAuto" | "absentAutoInk"
  | "comboUnderline";

export interface Palette extends Record<ColorKey, RGBA> {
  id: string;
  name: string;
  tagline: string;
  /** 自定义主题是从哪套内置主题复制来的（用于「恢复为原样」）；内置主题为 undefined */
  baseID?: string;

  statusStyle: StatusStyle;

  cardRadius: number;
  chipRadius: number;
  fieldRadius: number;
  capsuleButtons: boolean;
  chipStyle: ChipStyle;
  /** 卡片阴影不透明度，0 = 无阴影 */
  shadowOpacity: number;
  scheme: Scheme;

  extras: MaterialExtras;
  /** 是 Material 主题（或基于它的自定义主题）：标记方块用更大的圆角 */
  isMaterial: boolean;
}

// MARK: - 颜色字段表（编码、设置页取色器都从这里来）

export type ColorGroup = "surface" | "text" | "status" | "marks";

/** 分组标题（= Swift `Palette.ColorGroup.rawValue`），顺序即设置页里的顺序 */
export const COLOR_GROUPS: readonly { id: ColorGroup; title: string }[] = [
  { id: "surface", title: "背景与表面" },
  { id: "text", title: "文字与强调" },
  { id: "status", title: "状态" },
  { id: "marks", title: "标记（对 / 偏 / 无）" },
];

export interface ColorField {
  key: ColorKey;
  label: string;
  group: ColorGroup;
  /** 只有「色块」状态条才用到（选「小圆点 + 文字」时设置页里不显示） */
  pillOnly: boolean;
}

function field(key: ColorKey, label: string, group: ColorGroup): ColorField {
  return { key, label, group, pillOnly: key.startsWith("statusOk") || key.startsWith("statusWarn") };
}

export const colorFields: readonly ColorField[] = [
  field("bgTop", "背景（左上）", "surface"),
  field("bgMid", "背景（中）", "surface"),
  field("bgBottom", "背景（右下）", "surface"),
  field("surface", "卡片底", "surface"),
  field("stage", "标记台底", "surface"),
  field("field", "输入框底", "surface"),
  field("border", "边框", "surface"),

  field("ink", "正文", "text"),
  field("muted", "次要文字", "text"),
  field("accent", "强调色", "text"),
  field("accentSoft", "强调色浅底", "text"),
  field("onAccent", "强调色上的文字", "text"),
  field("secondary", "次要按钮底", "text"),

  field("ok", "正常", "status"),
  field("warn", "警告", "status"),
  field("danger", "错误", "status"),
  field("statusOkBg", "状态条·正常 底", "status"),
  field("statusOkBorder", "状态条·正常 边", "status"),
  field("statusWarnBg", "状态条·警告 底", "status"),
  field("statusWarnBorder", "状态条·警告 边", "status"),

  field("nodeIdle", "未标记", "marks"),
  field("hit", "对", "marks"),
  field("present", "偏", "marks"),
  field("absent", "无", "marks"),
  field("onMark", "色块上的文字", "marks"),
  field("hitAuto", "自动带出·对 底", "marks"),
  field("hitAutoInk", "自动带出·对 字", "marks"),
  field("presentAuto", "自动带出·偏 底", "marks"),
  field("presentAutoInk", "自动带出·偏 字", "marks"),
  field("absentAuto", "自动带出·无 底", "marks"),
  field("absentAutoInk", "自动带出·无 字", "marks"),
  field("comboUnderline", "组合下划线", "marks"),
];

export const RADIUS_RANGE = { min: 0, max: 24 } as const;
export const SHADOW_RANGE = { min: 0, max: 0.4 } as const;

// MARK: - 从基础色推导 Material 扩展色（= Swift `extension Palette` 里的计算属性）

export const surfaceLow = (p: Palette): RGBA => p.extras.surfaceLow ?? p.stage;
export const surfaceHigh = (p: Palette): RGBA => p.extras.surfaceHigh ?? blended(p.stage, p.ink, 0.06);
export const surfaceHighest = (p: Palette): RGBA => p.extras.surfaceHighest ?? blended(p.stage, p.ink, 0.12);
export const tonal = (p: Palette): RGBA => p.extras.tonal ?? p.accentSoft;
export const onTonal = (p: Palette): RGBA => p.extras.onTonal ?? p.ink;
export const outline = (p: Palette): RGBA => p.extras.outline ?? blended(p.border, p.ink, 0.4);
export const onAccentSoft = (p: Palette): RGBA => p.extras.onAccentSoft ?? p.ink;
export const inverseSurface = (p: Palette): RGBA => p.extras.inverseSurface ?? p.ink;
export const inverseOnSurface = (p: Palette): RGBA => p.extras.inverseOnSurface ?? p.surface;
export const inversePrimary = (p: Palette): RGBA => p.extras.inversePrimary ?? p.accentSoft;

/** 字头方块（标记台里的大字）的圆角：Material 主题是芯片圆角的 2 倍，旧主题与芯片一致 */
export const tileRadius = (p: Palette): number => (p.isMaterial ? p.chipRadius * 2 : p.chipRadius);

export type MarkStateView = "none" | "hit" | "present" | "absent";

/** 给标记状态配色（背景, 文字）。`auto` 为自动带出的浅色。 */
export function nodeColors(p: Palette, state: MarkStateView, auto: boolean): { bg: RGBA; fg: RGBA } {
  switch (state) {
    case "none":
      return { bg: p.nodeIdle, fg: p.ink };
    case "hit":
      return auto ? { bg: p.hitAuto, fg: p.hitAutoInk } : { bg: p.hit, fg: p.onMark };
    case "present":
      return auto ? { bg: p.presentAuto, fg: p.presentAutoInk } : { bg: p.present, fg: p.onMark };
    case "absent":
      return auto ? { bg: p.absentAuto, fg: p.absentAutoInk } : { bg: p.absent, fg: p.onMark };
  }
}

// MARK: - Material 主题色

export interface MaterialSeed {
  id: string;
  name: string;
  hue: number;
  chroma: number;
}

export const materialSeeds: readonly MaterialSeed[] = [
  { id: "cinnabar", name: "朱砂", hue: 38, chroma: 0.15 },
  { id: "indigo", name: "靛蓝", hue: 277, chroma: 0.17 },
  { id: "teal", name: "青碧", hue: 195, chroma: 0.1 },
  { id: "amber", name: "琥珀", hue: 78, chroma: 0.12 },
  { id: "wisteria", name: "紫藤", hue: 318, chroma: 0.14 },
];

export const defaultSeed: MaterialSeed = materialSeeds[0]!;

export const seedNamed = (id: string): MaterialSeed | undefined => materialSeeds.find((s) => s.id === id);

/** 色板圆点用的代表色（浅色模式下的 primary） */
export const seedSwatch = (seed: MaterialSeed): RGBA => materialTone(seed.hue, seed.chroma, 40);

// MARK: - 颜色角色（字段名与样图的 CSS 变量一一对应）

export interface MaterialRoles {
  primary: RGBA; onPrimary: RGBA; primaryContainer: RGBA; onPrimaryContainer: RGBA;
  secondary: RGBA; secondaryContainer: RGBA; onSecondaryContainer: RGBA;
  tertiary: RGBA;
  bg: RGBA; surfLowest: RGBA; surfLow: RGBA; surfContainer: RGBA; surfHigh: RGBA; surfHighest: RGBA;
  onSurface: RGBA; onSurfaceVariant: RGBA; outline: RGBA; outlineVariant: RGBA;
  inverseSurface: RGBA; inverseOnSurface: RGBA; inversePrimary: RGBA;
  error: RGBA;
  hit: RGBA; onHit: RGBA; hitContainer: RGBA; onHitContainer: RGBA;
  present: RGBA; onPresent: RGBA; presentContainer: RGBA; onPresentContainer: RGBA;
  absent: RGBA; onAbsent: RGBA; absentContainer: RGBA; onAbsentContainer: RGBA;
}

export function materialRoles(seed: MaterialSeed, dark: boolean): MaterialRoles {
  const h = seed.hue;
  const c = seed.chroma;
  const P = (t: number) => materialTone(h, c, t);
  const S = (t: number) => materialTone(h + 12, c * 0.32, t);
  const T = (t: number) => materialTone(h + 65, c * 0.75, t);
  const N = (t: number) => materialTone(h, 0.009, t);
  const V = (t: number) => materialTone(h, 0.02, t);
  const E = (t: number) => materialTone(28, 0.18, t);
  const G = (t: number) => materialTone(150, 0.15, t);
  const U = (t: number) => materialTone(305, 0.16, t);

  if (dark) {
    return {
      primary: P(80), onPrimary: P(20), primaryContainer: P(30), onPrimaryContainer: P(90),
      secondary: S(80), secondaryContainer: S(30), onSecondaryContainer: S(90),
      tertiary: T(60),
      bg: N(7), surfLowest: N(4), surfLow: N(11), surfContainer: N(13), surfHigh: N(18), surfHighest: N(23),
      onSurface: N(90), onSurfaceVariant: V(80), outline: V(60), outlineVariant: V(32),
      inverseSurface: N(90), inverseOnSurface: N(20), inversePrimary: P(40),
      error: E(80),
      hit: G(72), onHit: G(12), hitContainer: G(28), onHitContainer: G(88),
      present: U(74), onPresent: U(14), presentContainer: U(30), onPresentContainer: U(90),
      absent: V(44), onAbsent: V(95), absentContainer: V(27), onAbsentContainer: V(82),
    };
  }
  return {
    primary: P(40), onPrimary: P(100), primaryContainer: P(90), onPrimaryContainer: P(10),
    secondary: S(40), secondaryContainer: S(90), onSecondaryContainer: S(10),
    tertiary: T(40),
    bg: N(98), surfLowest: N(100), surfLow: N(96), surfContainer: N(94), surfHigh: N(92), surfHighest: N(90),
    onSurface: N(10), onSurfaceVariant: V(30), outline: V(50), outlineVariant: V(80),
    inverseSurface: N(20), inverseOnSurface: N(95), inversePrimary: P(80),
    error: E(40),
    hit: G(42), onHit: WHITE, hitContainer: G(88), onHitContainer: G(18),
    present: U(46), onPresent: WHITE, presentContainer: U(88), onPresentContainer: U(18),
    absent: V(48), onAbsent: WHITE, absentContainer: V(84), onAbsentContainer: V(25),
  };
}

// MARK: - 生成 Palette

/** 材质主题的 id：`m-<色>-<light|dark>` */
export const materialID = (seed: string, dark: boolean): string => `m-${seed}-${dark ? "dark" : "light"}`;

/** 从主题 id 反解出 (色, 是否深色)；不是材质主题返回 null。 */
export function parseMaterialID(id: string): { seed: MaterialSeed; dark: boolean } | null {
  const parts = id.split("-").filter((s) => s.length > 0);
  // Swift 的 split(separator:) 会丢掉空段；"m--x" 之类也按 3 段处理
  if (parts.length !== 3 || parts[0] !== "m") return null;
  const seed = seedNamed(parts[1]!);
  const mode = parts[2];
  if (!seed || (mode !== "light" && mode !== "dark")) return null;
  return { seed, dark: mode === "dark" };
}

/** 一套 Material 3 主题：主题色 + 明暗 → 整套配色。 */
export function materialPalette(seed: MaterialSeed, dark: boolean): Palette {
  const r = materialRoles(seed, dark);
  // 状态色：正常用「对」的绿，警告用固定的琥珀（浅 / 深各一个），错误用 M3 error
  const warn = dark ? fromHex24(0xfbbf24) : fromHex24(0x8a5a00);
  return {
    id: materialID(seed.id, dark),
    name: `${seed.name} · ${dark ? "深色" : "浅色"}`,
    tagline: `Material 3 · 由「${seed.name}」自动生成`,
    bgTop: r.bg, bgMid: r.bg, bgBottom: r.bg,
    surface: r.bg, stage: r.surfContainer, field: r.surfLowest,
    border: r.outlineVariant, ink: r.onSurface, muted: r.onSurfaceVariant,
    accent: r.primary, accentSoft: r.primaryContainer, onAccent: r.onPrimary,
    ok: r.hit, warn, danger: r.error, secondary: r.secondary,
    nodeIdle: r.surfHighest, hit: r.hit, present: r.present, absent: r.absent,
    onMark: r.onHit,
    hitAuto: r.hitContainer, hitAutoInk: r.onHitContainer,
    presentAuto: r.presentContainer, presentAutoInk: r.onPresentContainer,
    absentAuto: r.absentContainer, absentAutoInk: r.onAbsentContainer,
    comboUnderline: dark ? fromHex24(0xf28db6) : fromHex24(0xc2185b),
    statusOkBg: CLEAR, statusOkBorder: CLEAR, statusWarnBg: CLEAR, statusWarnBorder: CLEAR,
    statusStyle: "plain",
    cardRadius: 24, chipRadius: 8, fieldRadius: 8, capsuleButtons: true,
    chipStyle: "solid", shadowOpacity: dark ? 0.32 : 0.12, scheme: dark ? "dark" : "light",
    extras: {
      surfaceHigh: r.surfHigh,
      surfaceHighest: r.surfHighest,
      tonal: r.secondaryContainer,
      onTonal: r.onSecondaryContainer,
      outline: r.outline,
      onAccentSoft: r.onPrimaryContainer,
      inverseSurface: r.inverseSurface,
      inverseOnSurface: r.inverseOnSurface,
      inversePrimary: r.inversePrimary,
      surfaceLow: r.surfLow,
    },
    isMaterial: true,
  };
}

/** 全部 Material 主题：每个主题色先浅后深。 */
export const materialPalettes: readonly Palette[] = materialSeeds.flatMap((s) => [
  materialPalette(s, false),
  materialPalette(s, true),
]);

/** 默认主题：朱砂 · 浅色 */
export const defaultTheme: Palette = materialPalette(defaultSeed, false);

// MARK: - 旧主题（保留给用过它们的人）

const h = fromHex24;

/** 默认：桌面版配色（暖纸色 + 朱砂 + 实心色块） */
const desktop: Palette = {
  id: "desktop", name: "桌面版", tagline: "暖纸色 · 朱砂 · 实心色块（默认）",
  bgTop: h(0xefe8dc), bgMid: h(0xf6f3ed), bgBottom: h(0xe8e2d6),
  surface: h(0xfffef9), stage: h(0xf8f5f0), field: WHITE,
  border: h(0xddd5c8), ink: h(0x1c1a17), muted: h(0x6b6560),
  accent: h(0xb84a2f), accentSoft: h(0xf0ddd6), onAccent: WHITE,
  ok: h(0x2d6a4f), warn: h(0x9a6700), danger: h(0xb3261e), secondary: h(0x5c5a55),
  nodeIdle: h(0xe8e4dc), hit: h(0x6aaa64), present: h(0x7e57c2), absent: h(0x787c7e),
  onMark: WHITE,
  hitAuto: h(0xb7d7b4), hitAutoInk: h(0x1f3d1c),
  presentAuto: h(0xc5b3e0), presentAutoInk: h(0x2d1b4e),
  absentAuto: h(0xc4c6c8), absentAutoInk: h(0x3a3a3a),
  comboUnderline: h(0xc45a8c),
  statusOkBg: h(0xeaf6ee), statusOkBorder: h(0x9fcdb1),
  statusWarnBg: h(0xfff6e0), statusWarnBorder: h(0xe0c070),
  statusStyle: "pill",
  cardRadius: 8, chipRadius: 4, fieldRadius: 8, capsuleButtons: false,
  chipStyle: "solid", shadowOpacity: 0, scheme: "light",
  extras: {}, isMaterial: false,
};

/** 原生：像系统自带 App。系统强调色，发丝分隔线，无阴影，圆角适中。 */
const native: Palette = {
  id: "native", name: "原生", tagline: "系统蓝 · 发丝线 · 像系统自带 App",
  bgTop: h(0xf3f3f5), bgMid: h(0xf3f3f5), bgBottom: h(0xf3f3f5),
  surface: WHITE, stage: h(0xfafafb), field: WHITE,
  border: h(0xe2e2e6), ink: h(0x1d1d1f), muted: h(0x86868b),
  accent: h(0x0a7aff), accentSoft: h(0xe3f0ff), onAccent: WHITE,
  ok: h(0x248a3d), warn: h(0xb25000), danger: h(0xd70015), secondary: h(0x6e6e73),
  nodeIdle: h(0xebebef), hit: h(0x34c759), present: h(0xaf52de), absent: h(0x8e8e93),
  onMark: WHITE,
  hitAuto: h(0xbfebcb), hitAutoInk: h(0x14532d),
  presentAuto: h(0xe4cbf5), presentAutoInk: h(0x4a1a6b),
  absentAuto: h(0xd5d5da), absentAutoInk: h(0x3a3a3c),
  comboUnderline: h(0xff2d55),
  statusOkBg: CLEAR, statusOkBorder: CLEAR, statusWarnBg: CLEAR, statusWarnBorder: CLEAR,
  statusStyle: "plain",
  cardRadius: 10, chipRadius: 6, fieldRadius: 8, capsuleButtons: false,
  chipStyle: "solid", shadowOpacity: 0, scheme: "light",
  extras: {}, isMaterial: false,
};

/** 墨宣：宣纸底、朱砂强调；标记用矿物颜料色并带细描边，圆角收小，像盖章。字头想用楷体可在字体设置里选。 */
const ink: Palette = {
  id: "ink", name: "墨宣", tagline: "宣纸 · 朱砂 · 矿物颜料色 · 细描边",
  bgTop: h(0xefe8da), bgMid: h(0xf3eee3), bgBottom: h(0xeae2d1),
  surface: h(0xfbf8f1), stage: h(0xf6f1e6), field: h(0xfdfbf6),
  border: h(0xd6cbb4), ink: h(0x2a2520), muted: h(0x7d7365),
  accent: h(0xb3372b), accentSoft: h(0xf0d9d3), onAccent: h(0xfbf1ec),
  ok: h(0x3f6e54), warn: h(0x946200), danger: h(0xa3261e), secondary: h(0x4a443c),
  nodeIdle: h(0xe7dfcc), hit: h(0x4f8b6a), present: h(0x7a68a6), absent: h(0x8a877f),
  onMark: h(0xfbf8f1),
  hitAuto: h(0xbfd8c4), hitAutoInk: h(0x1f4630),
  presentAuto: h(0xcfc6e3), presentAutoInk: h(0x372b59),
  absentAuto: h(0xd5d1c6), absentAutoInk: h(0x3e3a33),
  comboUnderline: h(0xb3372b),
  statusOkBg: CLEAR, statusOkBorder: CLEAR, statusWarnBg: CLEAR, statusWarnBorder: CLEAR,
  statusStyle: "plain",
  cardRadius: 5, chipRadius: 3, fieldRadius: 4, capsuleButtons: false,
  chipStyle: "solidOutlined", shadowOpacity: 0, scheme: "light",
  extras: {}, isMaterial: false,
};

/** 夜色：深色游戏感。高对比方块、琥珀强调色；标记色提亮，深底上依然醒目。 */
const night: Palette = {
  id: "night", name: "夜色", tagline: "深色 · 高对比方块 · 琥珀强调",
  bgTop: h(0x1a1a20), bgMid: h(0x141418), bgBottom: h(0x0f0f12),
  surface: h(0x1d1d23), stage: h(0x23232b), field: h(0x15151a),
  border: h(0x32323c), ink: h(0xf1f1f4), muted: h(0x9c9ca8),
  accent: h(0xffb020), accentSoft: h(0x3a2e14), onAccent: h(0x1a1300),
  ok: h(0x4ade80), warn: h(0xfbbf24), danger: h(0xfb7185), secondary: h(0x3a3a46),
  nodeIdle: h(0x30303a), hit: h(0x3fa45b), present: h(0x8b6ce0), absent: h(0x555563),
  onMark: WHITE,
  hitAuto: h(0x24452f), hitAutoInk: h(0x86e0a0),
  presentAuto: h(0x3a2f63), presentAutoInk: h(0xc7b6ff),
  absentAuto: h(0x3b3b45), absentAutoInk: h(0xb4b4c0),
  comboUnderline: h(0xff6fa3),
  statusOkBg: h(0x16301f), statusOkBorder: h(0x24573a),
  statusWarnBg: h(0x33290f), statusWarnBorder: h(0x6b531a),
  statusStyle: "pill",
  cardRadius: 12, chipRadius: 6, fieldRadius: 9, capsuleButtons: false,
  chipStyle: "solid", shadowOpacity: 0.28, scheme: "dark",
  extras: {}, isMaterial: false,
};

/** 清爽：现代轻量。靛蓝强调、大圆角、柔和阴影、胶囊按钮。 */
const fresh: Palette = {
  id: "fresh", name: "清爽", tagline: "靛蓝 · 大圆角 · 柔和阴影 · 胶囊按钮",
  bgTop: h(0xf6f7fb), bgMid: h(0xf4f5fa), bgBottom: h(0xeef0f8),
  surface: WHITE, stage: h(0xf3f4fb), field: WHITE,
  border: h(0xe4e7f1), ink: h(0x1f2430), muted: h(0x6b7280),
  accent: h(0x5b5bf0), accentSoft: h(0xe9e9ff), onAccent: WHITE,
  ok: h(0x15803d), warn: h(0xb45309), danger: h(0xdc2626), secondary: h(0x64748b),
  nodeIdle: h(0xe8ebf5), hit: h(0x30b97a), present: h(0x8b5cf6), absent: h(0x94a3b8),
  onMark: WHITE,
  hitAuto: h(0xc3ebd8), hitAutoInk: h(0x14532d),
  presentAuto: h(0xddd0fb), presentAutoInk: h(0x4c1d95),
  absentAuto: h(0xdde2ea), absentAutoInk: h(0x475569),
  comboUnderline: h(0xf43f5e),
  statusOkBg: h(0xe7f7ef), statusOkBorder: h(0xb4e3cb),
  statusWarnBg: h(0xfff4de), statusWarnBorder: h(0xf0d08a),
  statusStyle: "pill",
  cardRadius: 16, chipRadius: 9, fieldRadius: 11, capsuleButtons: true,
  chipStyle: "solid", shadowOpacity: 0.07, scheme: "light",
  extras: {}, isMaterial: false,
};

export const legacyPalettes: readonly Palette[] = [desktop, native, ink, night, fresh];

/** 内置主题：先是 10 套 Material（5 个主题色 × 浅 / 深），再是 5 套旧主题。 */
export const builtinPalettes: readonly Palette[] = [...materialPalettes, ...legacyPalettes];

export const paletteNamed = (id: string): Palette | undefined => builtinPalettes.find((p) => p.id === id);
export const isBuiltin = (p: Pick<Palette, "id">): boolean => builtinPalettes.some((b) => b.id === p.id);
export const isLegacyID = (id: string): boolean => legacyPalettes.some((p) => p.id === id);

// MARK: - 相等性（= Swift 的 `Palette: Equatable`）

export function palettesEqual(a: Palette, b: Palette): boolean {
  if (
    a.id !== b.id || a.name !== b.name || a.tagline !== b.tagline || a.baseID !== b.baseID ||
    a.statusStyle !== b.statusStyle || a.cardRadius !== b.cardRadius || a.chipRadius !== b.chipRadius ||
    a.fieldRadius !== b.fieldRadius || a.capsuleButtons !== b.capsuleButtons || a.chipStyle !== b.chipStyle ||
    a.shadowOpacity !== b.shadowOpacity || a.scheme !== b.scheme || a.isMaterial !== b.isMaterial
  ) return false;
  for (const f of colorFields) if (!colorsEqual(a[f.key], b[f.key])) return false;
  const keys = new Set([...Object.keys(a.extras), ...Object.keys(b.extras)]) as Set<keyof MaterialExtras>;
  for (const k of keys) {
    const x = a.extras[k];
    const y = b.extras[k];
    if (x === undefined || y === undefined) {
      if (x !== y) return false;
    } else if (!colorsEqual(x, y)) return false;
  }
  return true;
}

/** 深拷贝（颜色是不可变小对象，extras 需要复制一层） */
export function clonePalette(p: Palette): Palette {
  return { ...p, extras: { ...p.extras } };
}

// MARK: - 编码 / 解码（颜色以 "#RRGGBBAA" 字符串平铺存储）

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

export function encodePalette(p: Palette): Json {
  const o: Json = { id: p.id, name: p.name, tagline: p.tagline };
  if (p.baseID !== undefined) o.baseID = p.baseID;
  for (const f of colorFields) o[f.key] = toHexString(p[f.key]);
  o.cardRadius = p.cardRadius;
  o.chipRadius = p.chipRadius;
  o.fieldRadius = p.fieldRadius;
  o.shadowOpacity = p.shadowOpacity;
  o.capsuleButtons = p.capsuleButtons;
  o.chipStyle = p.chipStyle;
  o.statusStyle = p.statusStyle;
  o.scheme = p.scheme;
  return o;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * 解码一个自定义主题。缺失 / 损坏的字段回落到它所基于的内置主题（没有就用默认的 Material 主题），
 * 所以以后新增字段不会让旧的自定义主题文件失效；数值被夹到合法范围。没有 id（或 id 不是字符串）返回 null。
 */
export function decodePalette(raw: unknown): Palette | null {
  if (!isObject(raw)) return null;
  if (typeof raw.id !== "string") return null;

  const baseID = typeof raw.baseID === "string" ? raw.baseID : undefined;
  const base = paletteNamed(baseID ?? "") ?? defaultTheme;
  const p = clonePalette(base);
  p.id = raw.id;
  p.name = typeof raw.name === "string" ? raw.name : "自定义主题";
  p.tagline = typeof raw.tagline === "string" ? raw.tagline : "自定义";
  p.baseID = baseID;

  for (const f of colorFields) {
    const s = raw[f.key];
    if (typeof s === "string") {
      const c = parseHexString(s);
      if (c) p[f.key] = c;
    }
  }
  const radius = (key: string, fallback: number): number => {
    const v = raw[key];
    return typeof v === "number" && Number.isFinite(v) ? clamp(v, RADIUS_RANGE.min, RADIUS_RANGE.max) : fallback;
  };
  p.cardRadius = radius("cardRadius", p.cardRadius);
  p.chipRadius = radius("chipRadius", p.chipRadius);
  p.fieldRadius = radius("fieldRadius", p.fieldRadius);
  if (typeof raw.shadowOpacity === "number" && Number.isFinite(raw.shadowOpacity)) {
    p.shadowOpacity = clamp(raw.shadowOpacity, SHADOW_RANGE.min, SHADOW_RANGE.max);
  }
  if (typeof raw.capsuleButtons === "boolean") p.capsuleButtons = raw.capsuleButtons;
  if (typeof raw.chipStyle === "string" && (CHIP_STYLES as readonly string[]).includes(raw.chipStyle)) {
    p.chipStyle = raw.chipStyle as ChipStyle;
  }
  if (typeof raw.statusStyle === "string" && (STATUS_STYLES as readonly string[]).includes(raw.statusStyle)) {
    p.statusStyle = raw.statusStyle as StatusStyle;
  }
  if (typeof raw.scheme === "string") p.scheme = raw.scheme === "dark" ? "dark" : "light";
  return p;
}
