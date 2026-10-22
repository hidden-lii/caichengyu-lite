// 字体设置：界面字体、成语字头字体、字号缩放（与主题无关）。移植自 ThemeStore.swift 的 FontKind / FontChoice / FontSettings
// 与 Theme.swift 的 `Theme.font`。
//
// Swift 里实际用到的字体：
//   · 宋体  → "Songti SC"（macOS）          · 楷体 → "Kaiti SC"
//   · 系统  → `.system`（SF + 苹方）          · 圆体 → `.system(design: .rounded)`（SF Rounded，汉字回落到苹方）
//   · 等宽  → `.system(design: .monospaced)`（SF Mono，拼音 / 声韵调 / 快捷键）
//   · 用户从系统字体里挑的某个字体族
// Windows 上依次回退到：微软雅黑 UI / Segoe UI Variable（界面）、宋体 SimSun、楷体 KaiTi、黑体 SimHei、Consolas / Cascadia（等宽）。

export type FontKind = "songti" | "kaiti" | "system" | "rounded" | "family";

export interface FontChoice {
  kind: FontKind;
  family?: string;
}

export const FONT_KINDS: readonly FontKind[] = ["songti", "kaiti", "system", "rounded", "family"];

export const fontSongti: FontChoice = { kind: "songti" };
export const fontKaiti: FontChoice = { kind: "kaiti" };
export const fontSystem: FontChoice = { kind: "system" };
export const fontRounded: FontChoice = { kind: "rounded" };
export const fontFamily = (name: string): FontChoice => ({ kind: "family", family: name });

/** 预设项（下拉菜单顶部那几项） */
export const fontPresets: readonly { choice: FontChoice; label: string }[] = [
  { choice: fontSongti, label: "宋体（默认）" },
  { choice: fontKaiti, label: "楷体" },
  { choice: fontSystem, label: "系统字体（苹方）" },
  { choice: fontRounded, label: "圆体" },
];

export const fontChoiceEqual = (a: FontChoice, b: FontChoice): boolean =>
  a.kind === b.kind && (a.family ?? null) === (b.family ?? null);

/** 下拉菜单里的标签值 */
export const fontTag = (c: FontChoice): string => (c.kind === "family" ? `family:${c.family ?? ""}` : c.kind);

/** `FontChoice(tag:)`：非法返回 null */
export function fontFromTag(tag: string): FontChoice | null {
  if (tag.startsWith("family:")) {
    const name = tag.slice("family:".length);
    return name.length === 0 ? null : fontFamily(name);
  }
  if ((FONT_KINDS as readonly string[]).includes(tag) && tag !== "family") return { kind: tag as FontKind };
  return null;
}

/** 从 JSON 解码；未知种类 / 形状不对返回 null（调用方回落到默认值）。 */
export function decodeFontChoice(raw: unknown): FontChoice | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.kind !== "string" || !(FONT_KINDS as readonly string[]).includes(o.kind)) return null;
  if (o.family !== undefined && o.family !== null && typeof o.family !== "string") return null;
  const c: FontChoice = { kind: o.kind as FontKind };
  if (typeof o.family === "string") c.family = o.family;
  return c;
}

export function encodeFontChoice(c: FontChoice): Record<string, unknown> {
  return c.family === undefined ? { kind: c.kind } : { kind: c.kind, family: c.family };
}

/**
 * 字体设置，与主题无关。默认：界面文字用系统字体（苹方），成语字头用宋体，不缩放。
 * （v1 的默认是界面文字也用宋体；读到 v1 的设置文件时会迁移，见 ThemeStore.load。）
 */
export interface FontSettings {
  ui: FontChoice; // 界面文字
  word: FontChoice; // 成语字头（标记台标题、候选词、字芯片）
  scale: number; // 整体字号缩放
}

export const SCALE_RANGE = { min: 0.9, max: 1.25 } as const;

export const clampScale = (s: number): number => Math.min(Math.max(s, SCALE_RANGE.min), SCALE_RANGE.max);

export const defaultFonts = (): FontSettings => ({ ui: { ...fontSystem }, word: { ...fontSongti }, scale: 1 });

export const fontsEqual = (a: FontSettings, b: FontSettings): boolean =>
  fontChoiceEqual(a.ui, b.ui) && fontChoiceEqual(a.word, b.word) && a.scale === b.scale;

export const isDefaultFonts = (f: FontSettings): boolean => fontsEqual(f, defaultFonts());

/** 容错解码：任何坏字段回落到默认值，字号夹到合法范围。不是对象返回 null（= Swift 解码整体失败）。 */
export function decodeFontSettings(raw: unknown): FontSettings | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const f = defaultFonts();
  f.ui = decodeFontChoice(o.ui) ?? fontSystem;
  f.word = decodeFontChoice(o.word) ?? fontSongti;
  f.scale = typeof o.scale === "number" && Number.isFinite(o.scale) ? clampScale(o.scale) : 1;
  return f;
}

export function encodeFontSettings(f: FontSettings): Record<string, unknown> {
  return { ui: encodeFontChoice(f.ui), word: encodeFontChoice(f.word), scale: f.scale };
}

// MARK: - CSS 字体族

/**
 * 系统 UI 字体（macOS：SF + 苹方；Windows：Segoe UI Variable / 微软雅黑 UI）。
 * 最前面的 "CC CJK" 是 base.css 里定义的苹方别名：只覆盖汉字 / 全角标点，缩到 92%，对上 SwiftUI 里汉字比 Chrome 小一圈的差别；
 * 找不到苹方（Windows）时别名失效，直接用后面的字体。
 */
export const SYSTEM_STACK =
  '"CC CJK", -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI Variable Text", "Segoe UI", ' +
  '"Microsoft YaHei UI", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif';

/** 宋体：macOS 的 Songti SC；Windows 的 SimSun / NSimSun */
export const SONGTI_STACK =
  '"Songti SC", "STSong", "SimSun", "NSimSun", "宋体", "Noto Serif CJK SC", "Source Han Serif SC", serif';

/** 楷体：macOS 的 Kaiti SC；Windows 的 KaiTi */
export const KAITI_STACK = '"Kaiti SC", "STKaiti", "KaiTi", "KaiTi_GB2312", "楷体", "AR PL UKai CN", serif';

/** 圆体：SF Rounded（汉字回落到苹方） */
export const ROUNDED_STACK =
  'ui-rounded, "SF Pro Rounded", "Hiragino Maru Gothic ProN", ' + SYSTEM_STACK;

/** 等宽（拼音、声韵调、快捷键）：SF Mono → Menlo；Windows 的 Consolas / Cascadia Mono。汉字（如「组」）回落到系统字体。 */
export const MONO_STACK =
  'ui-monospace, "SF Mono", SFMono-Regular, Menlo, Monaco, "Cascadia Mono", Consolas, "Courier New", ' +
  '"PingFang SC", "Microsoft YaHei UI", monospace';

const quote = (name: string): string => `"${name.replace(/["\\]/g, "")}"`;

/** 一个 FontChoice 对应的 CSS font-family。`family` 为空时回落到系统字体（同 Swift）。 */
export function fontStack(choice: FontChoice): string {
  switch (choice.kind) {
    case "songti":
      return SONGTI_STACK;
    case "kaiti":
      return KAITI_STACK;
    case "system":
      return SYSTEM_STACK;
    case "rounded":
      return ROUNDED_STACK;
    case "family": {
      const name = choice.family ?? "";
      return name.length === 0 ? SYSTEM_STACK : `${quote(name)}, ${SYSTEM_STACK}`;
    }
  }
}

// MARK: - 系统已安装字体（设置页的下拉）

/**
 * 常见的系统字体族候选（macOS + Windows），用于在拿不到 `queryLocalFonts()` 的 WebView（WKWebView）里
 * 通过测量宽度探测哪些已安装。
 */
const CANDIDATE_FAMILIES: readonly string[] = [
  // macOS
  "PingFang SC", "PingFang TC", "PingFang HK", "Hiragino Sans GB", "Hiragino Sans", "Hiragino Mincho ProN",
  "Hiragino Maru Gothic ProN", "STHeiti", "STSong", "STKaiti", "STFangsong", "Songti SC", "Songti TC", "Kaiti SC",
  "Kaiti TC", "Heiti SC", "Heiti TC", "Yuanti SC", "Yuppy SC", "Libian SC", "Weibei SC", "Xingkai SC", "Wawati SC",
  "Hanzipen SC", "HanziPen SC", "Baoli SC", "Lantinghei SC", "Apple LiGothic", "Apple LiSung",
  "Helvetica Neue", "Helvetica", "Arial", "Avenir", "Avenir Next", "Menlo", "Monaco", "Courier New", "Georgia",
  "Times New Roman", "Optima", "Palatino", "Baskerville", "Gill Sans", "Futura", "Verdana", "Trebuchet MS",
  "SF Pro Text", "SF Pro Display", "SF Mono", "New York",
  // Windows
  "Microsoft YaHei", "Microsoft YaHei UI", "Microsoft JhengHei", "SimSun", "NSimSun", "SimHei", "KaiTi", "FangSong",
  "DengXian", "Segoe UI", "Segoe UI Variable", "Consolas", "Cascadia Mono", "Cascadia Code", "Calibri", "Cambria",
  "Tahoma", "Yu Gothic", "Yu Mincho", "Meiryo", "Malgun Gothic",
  // 跨平台
  "Noto Sans CJK SC", "Noto Serif CJK SC", "Source Han Sans SC", "Source Han Serif SC", "Noto Sans SC", "Noto Serif SC",
  "LXGW WenKai", "Inter", "JetBrains Mono", "Fira Code",
];

let cachedFamilies: Promise<string[]> | null = null;

function probeInstalled(candidates: readonly string[]): string[] {
  if (typeof document === "undefined") return [];
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return [];
  const sample = "合作无间 mmmmmmmmmmlli 0123456789";
  const baselines = ["monospace", "serif", "sans-serif"];
  const width = (font: string): number => {
    ctx.font = `72px ${font}`;
    return ctx.measureText(sample).width;
  };
  const base = baselines.map((b) => width(b));
  return candidates.filter((name) => baselines.some((b, i) => width(`"${name}", ${b}`) !== base[i]));
}

/** 系统已安装的字体族（按名称排序）。优先 `queryLocalFonts()`（Chromium / WebView2），否则探测常见字体。 */
export function installedFontFamilies(): Promise<string[]> {
  if (cachedFamilies) return cachedFamilies;
  cachedFamilies = (async () => {
    const w = globalThis as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> };
    let names: string[] = [];
    if (typeof w.queryLocalFonts === "function") {
      try {
        names = [...new Set((await w.queryLocalFonts()).map((f) => f.family))];
      } catch {
        names = [];
      }
    }
    if (names.length === 0) names = probeInstalled(CANDIDATE_FAMILIES);
    return names.sort((a, b) => a.localeCompare(b, "zh-Hans-CN", { numeric: true }));
  })();
  return cachedFamilies;
}
