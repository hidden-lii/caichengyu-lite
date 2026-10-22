// 字符串工具。
//
// 成语里的字一律按 Unicode 码点处理（`Array.from`），不要按 UTF-16 单元；
// 空白按 Unicode White_Space 属性判断，与 Swift `Unicode.Scalar.Properties.isWhitespace`、
// Rust `str::trim` 一致。注意不能用 JS 自带的 `String.prototype.trim`：它会裁掉 U+FEFF（BOM），
// 而 Swift / Rust 不裁；也不能用 `\s`（同样含 U+FEFF）。零宽空格 U+200B 两边都不裁。

const WHITE_SPACE_RE = /\p{White_Space}/u;
const TRIM_RE = /^\p{White_Space}+|\p{White_Space}+$/gu;
const SPLIT_RE = /\p{White_Space}+/u;
const ALL_WHITE_SPACE_RE = /\p{White_Space}+/gu;

/** 按 Unicode White_Space 属性裁掉首尾空白，与 Rust `str::trim` 一致（Swift：`trimmingUnicodeWhitespace`）。 */
export function trimUnicodeWhitespace(s: string): string {
  return s.replace(TRIM_RE, "");
}

/** 去掉字符串里的全部空白（对应桌面 `.replace(/\s/g, '')`）。 */
export function removeAllWhitespace(s: string): string {
  return s.replace(ALL_WHITE_SPACE_RE, "");
}

/** 某个码点是否属于 White_Space。 */
export function isWhitespaceCodePoint(cp: number): boolean {
  return WHITE_SPACE_RE.test(String.fromCodePoint(cp));
}

/** 按空白切分并丢弃空段（对应 Swift `split(whereSeparator: isWhitespace)`）。 */
export function splitWhitespace(s: string): string[] {
  const out: string[] = [];
  for (const part of s.split(SPLIT_RE)) {
    if (part.length > 0) out.push(part);
  }
  return out;
}

/** 字符串的码点数组。 */
export function codePointsOf(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) out.push(ch.codePointAt(0) as number);
  return out;
}

/** 码点数 */
export function codePointCount(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

/** 是否是合法的 Unicode 标量值（排除代理区与超出范围）。 */
export function isScalarValue(v: number): boolean {
  return v >= 0 && v <= 0x10ffff && !(v >= 0xd800 && v <= 0xdfff);
}

/**
 * 把一段码点还原成字符串；非法标量（代理区 / 越界）被跳过，与 Swift `Unicode.Scalar(v)` 返回 nil 时的处理一致。
 * 全是 BMP 时走快速路径。
 */
export function scalarsToString(src: ArrayLike<number>, start: number, length: number): string {
  let allBmp = true;
  for (let k = 0; k < length; k++) {
    const v = src[start + k];
    if (v > 0xffff || (v >= 0xd800 && v <= 0xdfff)) {
      allBmp = false;
      break;
    }
  }
  if (allBmp) {
    switch (length) {
      case 0:
        return "";
      case 1:
        return String.fromCharCode(src[start]);
      case 2:
        return String.fromCharCode(src[start], src[start + 1]);
      case 3:
        return String.fromCharCode(src[start], src[start + 1], src[start + 2]);
      case 4:
        return String.fromCharCode(src[start], src[start + 1], src[start + 2], src[start + 3]);
      default: {
        let out = "";
        for (let k = 0; k < length; k++) out += String.fromCharCode(src[start + k]);
        return out;
      }
    }
  }
  let out = "";
  for (let k = 0; k < length; k++) {
    const v = src[start + k];
    if (isScalarValue(v)) out += String.fromCodePoint(v);
  }
  return out;
}

/** 单个标量值转字符串；非法标量返回空串（同 Swift `Unicode.Scalar(v).map(String.init) ?? ""`）。 */
export function scalarToString(v: number): string {
  return isScalarValue(v) ? String.fromCodePoint(v) : "";
}

/** 单字（恰好一个码点）时返回它的码点，否则 null。 */
export function singleScalar(s: string): number | null {
  let first = -1;
  let n = 0;
  for (const ch of s) {
    if (n === 0) first = ch.codePointAt(0) as number;
    n += 1;
    if (n > 1) return null;
  }
  return n === 1 ? first : null;
}
