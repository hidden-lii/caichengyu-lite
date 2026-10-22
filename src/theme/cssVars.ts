// 把当前主题 + 字体输出成 CSS 变量 / data 属性，挂在 `document.documentElement` 上。
//
// 命名：`--cc-<Swift 里 Theme.* 属性名的 kebab-case>`，一一对应；Swift 的 `Theme.bg`（= palette.bgMid）叫 `--cc-bg`，
// `Theme.secondaryButton` 叫 `--cc-secondary`。完整对照表见 docs 或 README（src/theme/README.md）。

import { cssBlack, toCss } from "./color";
import {
  type ColorKey,
  type Palette,
  colorFields,
  inverseOnSurface,
  inversePrimary,
  inverseSurface,
  onAccentSoft,
  onTonal,
  outline,
  surfaceHigh,
  surfaceHighest,
  surfaceLow,
  tileRadius,
  tonal,
} from "./palette";
import { type FontSettings, MONO_STACK, SYSTEM_STACK, fontStack } from "./fonts";

const kebab = (s: string): string => s.replace(/[A-Z]/g, (m) => "-" + m.toLowerCase());

/** Palette 颜色字段 → CSS 变量名。`bgMid` 对应 Swift 的 `Theme.bg`，`secondary` 对应 `Theme.secondaryButton`。 */
export function colorVarName(key: ColorKey): string {
  if (key === "bgMid") return "--cc-bg";
  return "--cc-" + kebab(key);
}

/** 阴影层级（= Swift `Elevation.layers`）：(SwiftUI 半径, y 偏移, 不透明度) × 2 层；CSS 模糊 ≈ SwiftUI 半径 × 2 */
const ELEVATION: Record<"e1" | "e2" | "e3" | "e4", [[number, number, number], [number, number, number]]> = {
  e1: [[1, 1, 0.18], [1.5, 1, 0.08]],
  e2: [[1, 1, 0.18], [3, 2, 0.08]],
  e3: [[2, 2, 0.14], [7, 6, 0.1]],
  e4: [[3, 3, 0.16], [11, 10, 0.12]],
};

/** 阴影整体强度：主题的 shadowOpacity 以 0.12 为基准（M3 浅色）；无阴影的旧主题仍留一点点，保证悬浮件有层次 */
export const shadowScale = (p: Palette): number => Math.max(p.shadowOpacity, 0.05) / 0.12;

/** 一个阴影层级的 CSS box-shadow（两层） */
export function elevationShadow(p: Palette, level: "e1" | "e2" | "e3" | "e4"): string {
  const s = shadowScale(p);
  return ELEVATION[level]
    .map(([r, y, a]) => `0 ${y}px ${r * 2}px ${cssBlack(Math.min(1, a * s))}`)
    .join(", ");
}

const px = (n: number): string => `${Number(n.toFixed(3))}px`;

/**
 * SwiftUI 的对角渐变（左上 → 右下）：渐变线沿着矩形的对角线方向，两端恰好落在对角的两个角上。
 * CSS 的 `to bottom right` 在非正方形里不同（它让 50% 线过另两个角），所以按宽高算角度。
 */
export function diagonalGradient(p: Palette, width: number, height: number): string {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const deg = 90 + (Math.atan2(h, w) * 180) / Math.PI;
  return `linear-gradient(${Number(deg.toFixed(2))}deg, ${toCss(p.bgTop)}, ${toCss(p.bgMid)}, ${toCss(p.bgBottom)})`;
}

/** 当前主题 + 字体 → 全部 CSS 变量（名 → 值）。纯函数，便于单测。 */
export function themeCssVars(p: Palette, fonts: FontSettings, viewport?: { width: number; height: number }): Record<string, string> {
  const v: Record<string, string> = {};

  // 基础色（= Theme.bgTop / bg / bgBottom / surface / …）
  for (const f of colorFields) v[colorVarName(f.key)] = toCss(p[f.key]);

  // Material 扩展色（旧主题由基础色推导）
  v["--cc-surface-low"] = toCss(surfaceLow(p));
  v["--cc-surface-high"] = toCss(surfaceHigh(p));
  v["--cc-surface-highest"] = toCss(surfaceHighest(p));
  v["--cc-tonal"] = toCss(tonal(p));
  v["--cc-on-tonal"] = toCss(onTonal(p));
  v["--cc-outline"] = toCss(outline(p));
  v["--cc-on-accent-soft"] = toCss(onAccentSoft(p));
  v["--cc-inverse-surface"] = toCss(inverseSurface(p));
  v["--cc-inverse-on-surface"] = toCss(inverseOnSurface(p));
  v["--cc-inverse-primary"] = toCss(inversePrimary(p));

  // 形状
  v["--cc-card-radius"] = px(p.cardRadius);
  v["--cc-chip-radius"] = px(p.chipRadius);
  v["--cc-field-radius"] = px(p.fieldRadius);
  v["--cc-tile-radius"] = px(tileRadius(p));
  // 按钮圆角：胶囊 = 半高（给一个超大值即可）；否则 max(6, fieldRadius)
  v["--cc-button-radius"] = p.capsuleButtons ? "1000px" : px(Math.max(6, p.fieldRadius));
  // 视图里按主题分支算出来的圆角（Swift 里写在各视图中）
  v["--cc-column-radius"] = px(p.isMaterial ? 18 : Math.max(6, p.cardRadius - 2)); // 标记台里的字位列（CharColumn）
  v["--cc-history-radius"] = px(p.isMaterial ? 20 : p.cardRadius); // 已记录猜测条目
  v["--cc-detail-column-radius"] = px(Math.max(5, p.cardRadius - 2)); // 「详细」弹层里的字位列
  v["--cc-menu-outline"] = p.isMaterial ? "transparent" : toCss(p.border); // 悬浮菜单 / 提示卡的描边
  v["--cc-chip-outline"] = p.chipStyle === "solidOutlined" ? "rgb(0 0 0 / 0.22)" : "transparent"; // 标记芯片的颜料描边

  // 阴影
  v["--cc-shadow-opacity"] = String(p.shadowOpacity);
  v["--cc-shadow-scale"] = String(Number(shadowScale(p).toFixed(4)));
  v["--cc-shadow-e1"] = elevationShadow(p, "e1");
  v["--cc-shadow-e2"] = elevationShadow(p, "e2");
  v["--cc-shadow-e3"] = elevationShadow(p, "e3");
  v["--cc-shadow-e4"] = elevationShadow(p, "e4");
  // 卡片阴影（CardBackground）：无阴影时 none；否则 radius 7、y 2
  v["--cc-card-shadow"] =
    p.shadowOpacity > 0 ? `0 2px 14px ${cssBlack(p.shadowOpacity)}` : "none";

  // 背景渐变（左上 → 右下；平涂主题三色相同）。没给视口尺寸时用 16:10 近似。
  v["--cc-bg-gradient"] = diagonalGradient(p, viewport?.width ?? 1600, viewport?.height ?? 1000);

  // 遮罩
  v["--cc-scrim"] = "rgb(0 0 0 / 0.34)"; // 写库进行中的整窗遮罩（DeduceView.busyOverlay）
  v["--cc-scrim-soft"] = "rgb(0 0 0 / 0.08)"; // 设置页里的忙碌遮罩（LexiconSettingsView.busyOverlay）
  v["--cc-sheet-scrim"] = p.scheme === "dark" ? "rgb(0 0 0 / 0.5)" : "rgb(0 0 0 / 0.28)"; // 模态弹层后面的变暗

  // 字体
  v["--cc-font-ui"] = fontStack(fonts.ui);
  // 工作台专用的界面字体栈：把 "CC CJK" 换成稍宽一档的 "CC CJK W"（见 base.css），由 .dd-root / .dd-detail / .theme-menu 覆盖 --cc-font-ui 使用
  v["--cc-font-ui-w"] = fontStack(fonts.ui).replaceAll('"CC CJK"', '"CC CJK W"');
  v["--cc-font-word"] = fontStack(fonts.word);
  v["--cc-font-system"] = SYSTEM_STACK; // 原生控件（分段选择器等）固定用系统字体，不跟界面字体设置走
  v["--cc-font-mono"] = MONO_STACK;
  v["--cc-font-scale"] = String(fonts.scale);
  const systemUi = fonts.ui.kind === "system" || fonts.ui.kind === "rounded";
  // 纯汉字一行的行高：SwiftUI 的系统字体约 1.2 倍字号（沿用 Chrome 的 normal 即可）；Hiragino 等字体族在基准里只有 1.0 倍，
  // 而 Chrome 的 normal 是 1.5 倍（设置页的行距会被撑开）。输入框里的文字行则是 NSTextField 的算法，约 1.52 倍。
  v["--cc-cjk-lh"] = systemUi ? "normal" : "1";
  // 工作台里界面字体文字的行高：系统字体（苹方）≈ 1.2 倍字号，非系统字体（如冬青黑体）在 SwiftUI 里行高 ≈ 字号本身
  v["--cc-ui-lh"] = systemUi ? "1.2" : "0.94";
  v["--cc-field-lh"] = systemUi ? "1.3" : "1.52";
  // 「中等」字重（CSS 500）：SwiftUI 的 .medium 会在字体族里取最接近的字重，Hiragino Sans GB 等只有细 / 粗两档的字体会落到粗体；
  // Chrome 则按 CSS 规则把 500 落到常规。非系统界面字体统一按 600 取，才能对上基准里「候选」「已记录猜测」这类标题的粗细。
  v["--cc-w-medium"] = systemUi ? "500" : "600";
  return v;
}

/** 写 data 属性 / color-scheme / CSS 变量。`root` 默认是 `document.documentElement`。 */
export function applyThemeToElement(root: HTMLElement, p: Palette, fonts: FontSettings, viewport?: { width: number; height: number }): void {
  const vars = themeCssVars(p, fonts, viewport);
  const style = root.style;
  for (const [k, val] of Object.entries(vars)) style.setProperty(k, val);
  style.colorScheme = p.scheme;
  root.dataset.scheme = p.scheme;
  root.dataset.themeId = p.id;
  root.dataset.material = String(p.isMaterial);
  root.dataset.capsule = String(p.capsuleButtons);
  root.dataset.chipStyle = p.chipStyle === "solidOutlined" ? "solid-outlined" : "solid";
  root.dataset.statusStyle = p.statusStyle;
}
