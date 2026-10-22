// 颜色基础：sRGB（gamma 编码）分量 0...1 + 不透明度，十六进制往返，混合。
//
// 对应 Swift 的 `Color(hex:)` / `Color(hexString:)` / `Color.hexString` / `Color.blended(with:)`（MaterialColor.swift、ThemeStore.swift）。
// 内部一律用 0...1 的双精度分量（不提前量化到 8 位），和 Swift 的 `Color(.sRGB, red:green:blue:opacity:)` 一致；
// 只有写盘（`toHexString`）与输出 CSS 时才四舍五入到 8 位。

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export const rgba = (r: number, g: number, b: number, a = 1): RGBA => ({ r, g, b, a });

/** `Color(hex: 0xRRGGBB, opacity:)` */
export function fromHex24(hex: number, opacity = 1): RGBA {
  return {
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255,
    a: opacity,
  };
}

/** `Color.white`（sRGB 1,1,1,1） */
export const WHITE: RGBA = rgba(1, 1, 1, 1);
/** `Color.clear`（sRGB 0,0,0,0） */
export const CLEAR: RGBA = rgba(0, 0, 0, 0);

/** "#RRGGBB" 或 "#RRGGBBAA"（可无 #，两端空白会被去掉）；非法返回 null。 */
export function parseHexString(input: string): RGBA | null {
  let s = input.trim();
  if (s.startsWith("#")) s = s.slice(1);
  if (!(s.length === 6 || s.length === 8) || !/^[0-9a-fA-F]+$/.test(s)) return null;
  const v = parseInt(s, 16);
  if (s.length === 8) {
    // 8 位超过 2^31，不能用位运算
    return {
      r: Math.floor(v / 0x1000000) % 256 / 255,
      g: Math.floor(v / 0x10000) % 256 / 255,
      b: Math.floor(v / 0x100) % 256 / 255,
      a: (v % 256) / 255,
    };
  }
  return { r: ((v >> 16) & 0xff) / 255, g: ((v >> 8) & 0xff) / 255, b: (v & 0xff) / 255, a: 1 };
}

const byte = (x: number): number => Math.max(0, Math.min(255, Math.round(x * 255)));
const hex2 = (n: number): string => n.toString(16).toUpperCase().padStart(2, "0");

/** "#RRGGBBAA"（不透明度也写出来，保证 `.clear` 这类颜色能往返） */
export function toHexString(c: RGBA): string {
  return `#${hex2(byte(c.r))}${hex2(byte(c.g))}${hex2(byte(c.b))}${hex2(byte(c.a))}`;
}

/** 供 `<input type="color">` 用的 "#rrggbb"（丢掉不透明度，小写）。 */
export function toHex6(c: RGBA): string {
  return `#${hex2(byte(c.r))}${hex2(byte(c.g))}${hex2(byte(c.b))}`.toLowerCase();
}

/** CSS 颜色：不透明用 "#rrggbb"，否则 "#rrggbbaa"（WebKit / Chromium 都支持）。 */
export function toCss(c: RGBA): string {
  const base = `#${hex2(byte(c.r))}${hex2(byte(c.g))}${hex2(byte(c.b))}`;
  const a = byte(c.a);
  return (a === 255 ? base : base + hex2(a)).toLowerCase();
}

/** 在 sRGB 下把 `a` 向 `b` 混合 `fraction`（0...1），不透明度同样线性混合。 */
export function blended(a: RGBA, b: RGBA, fraction: number): RGBA {
  const f = Math.min(Math.max(fraction, 0), 1);
  return {
    r: a.r + (b.r - a.r) * f,
    g: a.g + (b.g - a.g) * f,
    b: a.b + (b.b - a.b) * f,
    a: a.a + (b.a - a.a) * f,
  };
}

export function colorsEqual(a: RGBA, b: RGBA): boolean {
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

/** 带 alpha 的 CSS 颜色（用于黑色阴影、状态层等） */
export function cssBlack(alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  return `rgb(0 0 0 / ${Number(a.toFixed(4))})`;
}
