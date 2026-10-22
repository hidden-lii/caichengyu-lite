// 拼音解析 / 标调 / 声韵拆分。对应 Swift `Pinyin/Pinyin.swift`（权威实现：桌面 src-tauri/src/pinyin.rs）。
//
// 与 Rust 的一处有意差异：带调的 ǖǘǚǜ 在 Rust 里拆成基础音 "ü"，而不带调的 "ü" 拆成 "v"，
// 同一读音会得到两种 ym，用户手输数字拼音（如 lv4）就会与词库不等。
// 这里统一规范为 "v"（与桌面 TS 引擎、Android 版一致），词库烘焙与手输走同一条路径。
//
// 规范化：Swift 的 `Character` 相等按 Unicode 规范等价判断（"ǎ" 的 NFC / NFD 写法相等），
// JS 字符串比较是逐码元的。所以凡是把拼音当字符匹配的地方，都先转 NFC，输出的音节也一律是 NFC，
// 这样「预组合」与「字母+组合符号」两种来源的同一个读音在 TS 里也相等。

import type { CharData } from "../model/types";
import { splitWhitespace, trimUnicodeWhitespace, removeAllWhitespace } from "../text";

export const initials: readonly string[] = [
  "zh", "ch", "sh", "b", "p", "m", "f", "d", "t", "n", "l", "g", "k", "h", "j", "q", "x", "r",
  "z", "c", "s", "y", "w",
];

/** 按长度降序（同长保持原序），保证 zh/ch/sh 先于 z/c/s 匹配。 */
const initialsLongestFirst: readonly string[] = initials
  .map((value, offset) => ({ value, offset }))
  .sort((a, b) => (a.value.length !== b.value.length ? b.value.length - a.value.length : a.offset - b.offset))
  .map((e) => e.value);

/** (带调字符, 基础字母, 声调)；ü 系基础字母统一为 v。 */
const toneChars: readonly { marked: string; base: string; tone: number }[] = [
  ["ā", "a", 1], ["á", "a", 2], ["ǎ", "a", 3], ["à", "a", 4],
  ["ē", "e", 1], ["é", "e", 2], ["ě", "e", 3], ["è", "e", 4],
  ["ī", "i", 1], ["í", "i", 2], ["ǐ", "i", 3], ["ì", "i", 4],
  ["ō", "o", 1], ["ó", "o", 2], ["ǒ", "o", 3], ["ò", "o", 4],
  ["ū", "u", 1], ["ú", "u", 2], ["ǔ", "u", 3], ["ù", "u", 4],
  ["ǖ", "v", 1], ["ǘ", "v", 2], ["ǚ", "v", 3], ["ǜ", "v", 4],
].map(([marked, base, tone]) => ({ marked: marked as string, base: base as string, tone: tone as number }));

const toneMarks: Readonly<Record<string, readonly string[]>> = {
  a: ["", "ā", "á", "ǎ", "à"],
  e: ["", "ē", "é", "ě", "è"],
  i: ["", "ī", "í", "ǐ", "ì"],
  o: ["", "ō", "ó", "ǒ", "ò"],
  u: ["", "ū", "ú", "ǔ", "ù"],
  v: ["", "ǖ", "ǘ", "ǚ", "ǜ"],
};

const markedVowels: ReadonlySet<string> = new Set(Array.from("āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ"));

function nfc(s: string): string {
  return s.normalize("NFC");
}

function hasMarkedVowel(s: string): boolean {
  for (const ch of s) if (markedVowels.has(ch)) return true;
  return false;
}

/** 标调元音在字符数组中的下标（先 a、e，再 ou 的 o、iu 的 u、ui 的 i，最后取最后一个元音）。 */
function toneVowelIndex(base: readonly string[]): number {
  const s: string[] = base.map((c) => {
    const lower = c.toLowerCase();
    const first = Array.from(lower)[0] ?? c;
    return first === "v" ? "ü" : first;
  });
  let i = s.indexOf("a");
  if (i >= 0) return i;
  i = s.indexOf("e");
  if (i >= 0) return i;
  if (s.length >= 2) {
    for (let k = 0; k < s.length - 1; k++) if (s[k] === "o" && s[k + 1] === "u") return k;
    for (let k = 0; k < s.length - 1; k++) if (s[k] === "i" && s[k + 1] === "u") return k + 1;
    for (let k = 0; k < s.length - 1; k++) if (s[k] === "u" && s[k + 1] === "i") return k + 1;
  }
  const vowels = new Set(["a", "e", "i", "o", "u", "ü"]);
  for (let k = s.length - 1; k >= 0; k--) if (vowels.has(s[k])) return k;
  return -1;
}

/** `jian4` → `jiàn`；已带调号的原样返回；轻声（5）只去掉数字。 */
export function markSyllable(syl: string): string {
  const raw = nfc(trimUnicodeWhitespace(syl));
  if (raw.length === 0 || hasMarkedVowel(raw)) return raw;
  const lower = raw.toLowerCase();
  const lowerChars = Array.from(lower);
  const last = lowerChars[lowerChars.length - 1];
  if (last === undefined || !"12345".includes(last) || lowerChars.length <= 1) return raw;
  const tone = Number(last);
  const baseChars = lowerChars.slice(0, -1);
  const baseMarkedChars = baseChars.map((c) => (c === "v" ? "ü" : c));
  if (tone === 5) return baseMarkedChars.join("");
  const idx = toneVowelIndex(baseChars);
  if (idx < 0 || idx >= baseMarkedChars.length) return baseMarkedChars.join("");
  const ch = baseMarkedChars[idx];
  const key = ch === "ü" ? "v" : ch;
  const marks = toneMarks[key];
  if (marks === undefined || tone >= marks.length || marks[tone].length === 0) {
    return baseMarkedChars.join("");
  }
  let out = "";
  for (let i = 0; i < baseMarkedChars.length; i++) {
    out += i === idx ? marks[tone] : baseMarkedChars[i];
  }
  return out;
}

export function normalizePinyinInput(pinyin: string): string {
  return splitWhitespace(pinyin)
    .map((s) => markSyllable(s))
    .join(" ");
}

/** 去掉调号，返回基础拼音（ü→v）与声调（缺省 5）。 */
export function stripTone(syl: string): { base: string; tone: number } {
  let s = nfc(syl).toLowerCase().replaceAll("ü", "v");
  let tone = 0;
  const chars = Array.from(s);
  const last = chars[chars.length - 1];
  if (last !== undefined && "12345".includes(last)) {
    tone = Number(last);
    chars.pop();
    s = chars.join("");
  }
  for (const entry of toneChars) {
    if (s.includes(entry.marked)) {
      s = s.replaceAll(entry.marked, entry.base);
      tone = entry.tone;
      break;
    }
  }
  if (tone === 0) tone = 5;
  return { base: s, tone };
}

export function splitInitial(py: string): { sm: string; ym: string } {
  const lower = nfc(py).toLowerCase();
  for (const initial of initialsLongestFirst) {
    if (lower.startsWith(initial)) return { sm: initial, ym: lower.slice(initial.length) };
  }
  return { sm: "", ym: lower };
}

/** 解析单个音节；返回的 `c` 为空串，由调用方填入汉字。 */
export function parseSyllable(syl: string): CharData {
  const trimmed = trimUnicodeWhitespace(syl);
  const { base, tone } = stripTone(trimmed);
  const { sm, ym } = splitInitial(base);
  return { c: "", py: base, sm, ym, tone };
}

/** 按 Unicode 码点切字（与 Rust `chars()` 一致），音节数不等时返回 null。 */
export function buildChars(word: string, pinyin: string): CharData[] | null {
  const scalars = Array.from(word);
  const syls = splitWhitespace(pinyin);
  if (scalars.length !== syls.length) return null;
  return scalars.map((scalar, i) => {
    const parsed = parseSyllable(syls[i]);
    parsed.c = scalar;
    return parsed;
  });
}

/** UI 用：先去掉成语里的空白，再先规范化拼音，对应桌面 `charsFromWordPinyin`。 */
export function charsFromWordPinyin(word: string, pinyin: string): CharData[] | null {
  return buildChars(removeAllWhitespace(word), normalizePinyinInput(pinyin));
}

function inToneRange(tone: number): boolean {
  return tone >= 1 && tone <= 5;
}

export function toneDigit(tone: number): string {
  return inToneRange(tone) ? String(tone) : "5";
}

/** `guo5 bu4 kan5 er5`：每个音节都带数字，轻声也写 5。 */
export function charsToDigitPinyin(chars: readonly CharData[]): string {
  return chars.map((ch) => (inToneRange(ch.tone) ? ch.py + String(ch.tone) : ch.py)).join(" ");
}

/** 把任意写法（音标 / 数字）统一成数字调号。 */
export function formatPinyinAsDigit(pinyin: string): string {
  return splitWhitespace(pinyin)
    .map((syl) => {
      const p = parseSyllable(syl);
      return inToneRange(p.tone) ? p.py + String(p.tone) : p.py;
    })
    .join(" ");
}

export function toneLabel(tone: number): string {
  return tone >= 1 && tone <= 4 ? String(tone) : "轻";
}

/** `charsToMarkedPinyin`：按每字当前读音生成带调号拼音。 */
export function charsToMarkedPinyin(chars: readonly CharData[]): string {
  return chars.map((ch) => markSyllable(ch.py + toneDigit(ch.tone))).join(" ");
}
