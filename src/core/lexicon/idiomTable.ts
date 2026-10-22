// 列式二进制词库索引（.idx）。对应 Swift `Lexicon/IdiomTable.swift`。
//
// 目标：启动时直接把文件字节当成类型化数组用，不做 JSON 解析、不建对象。
// 所有数值为小端；各区段 8 字节对齐；校验和覆盖 header 之后到释义区之前的全部索引区
// （释义区很大且只在悬停时读，不参与校验）。
//
// 布局（字节偏移）：
//   0..63    header：u32[8] = magic, version, count, totalChars, smCount, ymCount, smTableBytes, ymTableBytes
//            u64[4] = explBlobSize, checksum, fileSize（偏移 32 / 40 / 48）
//   之后依次： sylStart u32[count+1] · flags u8[count] · scalars u32[N] · sm u8[N] · ym u16[N]
//            · tone u8[N] · explStart u32[count+1] · hashes u64[count] · hashRows u32[count]
//            · smTable · ymTable · explBlob
// 其中 N = totalChars（所有词的字数之和）。`flags` 为 0 表示读音有效；1 表示拼音非空但无法解析
// （音节数与字数不符等）；2 表示拼音为空。非 0 的词，其 sm/ym/tone 区位全部为 0。
// sm/ym 是各自字符串表的下标，下标 0 恒为空串。字符串表项为「1 字节长度 + UTF-8 字节」。
//
// 假定运行平台为小端（WKWebView / WebView2 / Node 都是）；模块加载时会校验。

import type { CharData } from "../model/types";
import { charsToMarkedPinyin } from "../pinyin/pinyin";
import { scalarsToString } from "../text";
import { fnvScalars, hashOut, hashWords } from "./hash";

const IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
if (!IS_LITTLE_ENDIAN) {
  throw new Error("词库索引（.idx）按小端存储，当前平台不是小端");
}

export type IdiomTableErrorKind = "io" | "badMagic" | "unsupportedVersion" | "truncated" | "checksumMismatch";

export class IdiomTableError extends Error {
  readonly kind: IdiomTableErrorKind;

  constructor(kind: IdiomTableErrorKind, detail?: string | number) {
    super(IdiomTableError.describe(kind, detail));
    this.name = "IdiomTableError";
    this.kind = kind;
  }

  private static describe(kind: IdiomTableErrorKind, detail?: string | number): string {
    switch (kind) {
      case "io":
        return `读取词库索引失败：${detail ?? ""}`;
      case "badMagic":
        return "不是词库索引文件";
      case "unsupportedVersion":
        return `词库索引格式版本不受支持：${detail ?? ""}`;
      case "truncated":
        return "词库索引文件已损坏（长度不符）";
      case "checksumMismatch":
        return "词库索引校验失败";
    }
  }
}

/** 读音有效性标记，对应 `flags` 区的值。 */
export const ReadingFlag = {
  valid: 0,
  invalid: 1,
  empty: 2,
} as const;

const HEADER_SIZE = 64;

function align8(x: number): number {
  return (x + 7) & ~7;
}

interface Layout {
  count: number;
  totalChars: number;
  smCount: number;
  ymCount: number;
  smTableBytes: number;
  ymTableBytes: number;
  explBlobSize: number;
  sylStartOff: number;
  flagsOff: number;
  scalarsOff: number;
  smOff: number;
  ymOff: number;
  toneOff: number;
  explStartOff: number;
  hashesOff: number;
  hashRowsOff: number;
  smTableOff: number;
  ymTableOff: number;
  explBlobOff: number;
  fileSize: number;
}

function makeLayout(
  count: number,
  totalChars: number,
  smCount: number,
  ymCount: number,
  smTableBytes: number,
  ymTableBytes: number,
  explBlobSize: number,
): Layout {
  let cursor = HEADER_SIZE;
  const place = (bytes: number): number => {
    const off = align8(cursor);
    cursor = off + bytes;
    return off;
  };
  const l: Layout = {
    count,
    totalChars,
    smCount,
    ymCount,
    smTableBytes,
    ymTableBytes,
    explBlobSize,
    sylStartOff: 0,
    flagsOff: 0,
    scalarsOff: 0,
    smOff: 0,
    ymOff: 0,
    toneOff: 0,
    explStartOff: 0,
    hashesOff: 0,
    hashRowsOff: 0,
    smTableOff: 0,
    ymTableOff: 0,
    explBlobOff: 0,
    fileSize: 0,
  };
  l.sylStartOff = place(4 * (count + 1));
  l.flagsOff = place(count);
  l.scalarsOff = place(4 * totalChars);
  l.smOff = place(totalChars);
  l.ymOff = place(2 * totalChars);
  l.toneOff = place(totalChars);
  l.explStartOff = place(4 * (count + 1));
  l.hashesOff = place(8 * count);
  l.hashRowsOff = place(4 * count);
  l.smTableOff = place(smTableBytes);
  l.ymTableOff = place(ymTableBytes);
  l.explBlobOff = place(explBlobSize);
  l.fileSize = cursor;
  return l;
}

const utf8Decoder = new TextDecoder("utf-8");
const utf8Encoder = new TextEncoder();

/** 把任意字节视图整理成「起点 8 字节对齐」的 ArrayBuffer 与 Uint8Array（不对齐时拷贝一份）。 */
function alignedBytes(data: Uint8Array | ArrayBuffer): Uint8Array {
  if (!ArrayBuffer.isView(data)) return new Uint8Array(data);
  if (data.byteOffset % 8 === 0) return data;
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  return copy;
}

/** 只读词库表。 */
export class IdiomTable {
  /** 小端字节 'C','C','Y','I' */
  static readonly magic = 0x49594343;
  static readonly formatVersion = 1;

  readonly count: number;
  readonly totalChars: number;

  // 引擎热路径直接读这些数组；下标 = start(i) + pos。
  readonly scalars: Uint32Array;
  readonly smCodes: Uint8Array;
  readonly ymCodes: Uint16Array;
  readonly tones: Uint8Array;
  /** 长度 count + 1 */
  readonly sylStart: Uint32Array;
  /** 读音有效性标记（`ReadingFlag`），长度 count */
  readonly flags: Uint8Array;
  private readonly explStart: Uint32Array;
  private readonly explBlob: Uint8Array;
  /** 每条 64 位哈希按 (lo, hi) 排成 u32 对，已按 (hash, row) 升序 */
  private readonly hashes: Uint32Array;
  private readonly hashRows: Uint32Array;

  /** 声母字符串表，下标 = `smCodes` 的值；0 恒为空串（零声母）。 */
  readonly smStrings: readonly string[];
  /** 韵母字符串表，下标 = `ymCodes` 的值。 */
  readonly ymStrings: readonly string[];

  private constructor(
    base: ArrayBuffer,
    baseOffset: number,
    l: Layout,
    smStrings: string[],
    ymStrings: string[],
  ) {
    this.count = l.count;
    this.totalChars = l.totalChars;
    this.sylStart = new Uint32Array(base, baseOffset + l.sylStartOff, l.count + 1);
    this.flags = new Uint8Array(base, baseOffset + l.flagsOff, l.count);
    this.scalars = new Uint32Array(base, baseOffset + l.scalarsOff, l.totalChars);
    this.smCodes = new Uint8Array(base, baseOffset + l.smOff, l.totalChars);
    this.ymCodes = new Uint16Array(base, baseOffset + l.ymOff, l.totalChars);
    this.tones = new Uint8Array(base, baseOffset + l.toneOff, l.totalChars);
    this.explStart = new Uint32Array(base, baseOffset + l.explStartOff, l.count + 1);
    this.hashes = new Uint32Array(base, baseOffset + l.hashesOff, 2 * l.count);
    this.hashRows = new Uint32Array(base, baseOffset + l.hashRowsOff, l.count);
    this.explBlob = new Uint8Array(base, baseOffset + l.explBlobOff, l.explBlobSize);
    this.smStrings = smStrings;
    this.ymStrings = ymStrings;
  }

  // MARK: 加载

  /**
   * 从字节加载并校验 magic / 版本 / 长度 / 校验和，任何不符都抛 `IdiomTableError`（调用方据此重建）。
   * 不拷贝数据（起点不对齐时才拷贝一份），所以调用方之后不要改动传入的字节。
   */
  static open(data: Uint8Array | ArrayBuffer): IdiomTable {
    const bytes = alignedBytes(data);
    const size = bytes.byteLength;
    if (size < HEADER_SIZE) throw new IdiomTableError("truncated");
    const buffer = bytes.buffer as ArrayBuffer;
    const base = bytes.byteOffset;
    const view = new DataView(buffer, base, size);
    if (view.getUint32(0, true) !== IdiomTable.magic) throw new IdiomTableError("badMagic");
    const version = view.getUint32(4, true);
    if (version !== IdiomTable.formatVersion) throw new IdiomTableError("unsupportedVersion", version);
    const count = view.getUint32(8, true);
    const totalChars = view.getUint32(12, true);
    const smCount = view.getUint32(16, true);
    const ymCount = view.getUint32(20, true);
    const smTableBytes = view.getUint32(24, true);
    const ymTableBytes = view.getUint32(28, true);
    const explBlobSize = view.getUint32(32, true);
    const explBlobSizeHi = view.getUint32(36, true);
    const checksumLo = view.getUint32(40, true);
    const checksumHi = view.getUint32(44, true);
    const fileSizeLo = view.getUint32(48, true);
    const fileSizeHi = view.getUint32(52, true);
    if (explBlobSizeHi !== 0 || fileSizeHi !== 0) throw new IdiomTableError("truncated");

    const layout = makeLayout(count, totalChars, smCount, ymCount, smTableBytes, ymTableBytes, explBlobSize);
    if (fileSizeLo !== size || layout.fileSize !== size) throw new IdiomTableError("truncated");

    const indexWords = new Uint32Array(buffer, base + HEADER_SIZE, (layout.explBlobOff - HEADER_SIZE) / 4);
    hashWords(indexWords, 0, indexWords.length / 2);
    if (hashOut.lo !== checksumLo || hashOut.hi !== checksumHi) throw new IdiomTableError("checksumMismatch");

    const sm = readStrings(bytes, layout.smTableOff, smTableBytes, smCount);
    const ym = readStrings(bytes, layout.ymTableOff, ymTableBytes, ymCount);
    return new IdiomTable(buffer, base, layout, sm, ym);
  }

  private static emptyTable: IdiomTable | null = null;

  /** 空表（一定能构建并回读）。 */
  static get empty(): IdiomTable {
    if (IdiomTable.emptyTable === null) {
      IdiomTable.emptyTable = IdiomTable.open(new IdiomTableBuilder().serialize());
    }
    return IdiomTable.emptyTable;
  }

  // MARK: 访问

  start(i: number): number {
    return this.sylStart[i];
  }

  length(i: number): number {
    return this.sylStart[i + 1] - this.sylStart[i];
  }

  flag(i: number): number {
    return this.flags[i];
  }

  scalarArray(i: number): Uint32Array {
    return this.scalars.subarray(this.sylStart[i], this.sylStart[i + 1]);
  }

  word(i: number): string {
    return scalarsToString(this.scalars, this.sylStart[i], this.sylStart[i + 1] - this.sylStart[i]);
  }

  /** 第 i 条的逐字读音。`flag != valid` 的条目返回空数组。 */
  chars(i: number): CharData[] {
    if (this.flags[i] !== ReadingFlag.valid) return [];
    const s = this.sylStart[i];
    const n = this.sylStart[i + 1] - s;
    const out: CharData[] = new Array(n);
    for (let k = 0; k < n; k++) {
      const sm = this.smStrings[this.smCodes[s + k]];
      const ym = this.ymStrings[this.ymCodes[s + k]];
      out[k] = {
        c: scalarsToString(this.scalars, s + k, 1),
        py: sm + ym,
        sm,
        ym,
        tone: this.tones[s + k],
      };
    }
    return out;
  }

  /** 带调号的拼音（由读音拼出，不是源文件里的原字符串）。 */
  pinyin(i: number): string {
    return charsToMarkedPinyin(this.chars(i));
  }

  explanationBytes(i: number): Uint8Array {
    return this.explBlob.subarray(this.explStart[i], this.explStart[i + 1]);
  }

  hasExplanation(i: number): boolean {
    return this.explStart[i + 1] > this.explStart[i];
  }

  explanation(i: number): string {
    return utf8Decoder.decode(this.explanationBytes(i));
  }

  /** 按词面查行号（二分查找 64 位哈希索引，无需构建字典）；找不到返回 null。 */
  rowForWord(word: string): number | null {
    const key: number[] = [];
    for (const ch of word) key.push(ch.codePointAt(0) as number);
    return this.rowForScalars(key);
  }

  rowForScalars(key: ArrayLike<number>): number | null {
    if (this.count === 0) return null;
    fnvScalars(key, 0, key.length);
    const hHi = hashOut.hi;
    const hLo = hashOut.lo;
    const hashes = this.hashes;
    let lo = 0;
    let hi = this.count;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const mHi = hashes[2 * mid + 1];
      const mLo = hashes[2 * mid];
      if (mHi < hHi || (mHi === hHi && mLo < hLo)) lo = mid + 1;
      else hi = mid;
    }
    let k = lo;
    while (k < this.count && hashes[2 * k + 1] === hHi && hashes[2 * k] === hLo) {
      const row = this.hashRows[k];
      if (this.length(row) === key.length) {
        const s = this.sylStart[row];
        let same = true;
        for (let p = 0; p < key.length; p++) {
          if (this.scalars[s + p] !== key[p]) {
            same = false;
            break;
          }
        }
        if (same) return row;
      }
      k += 1;
    }
    return null;
  }
}

function readStrings(bytes: Uint8Array, off: number, size: number, count: number): string[] {
  const out: string[] = [];
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p >= size) throw new IdiomTableError("truncated");
    const len = bytes[off + p];
    p += 1;
    if (p + len > size) throw new IdiomTableError("truncated");
    out.push(utf8Decoder.decode(bytes.subarray(off + p, off + p + len)));
    p += len;
  }
  return out;
}

// MARK: - 构建器

/** 可增长的类型化数组缓冲。 */
class Growable<A extends Uint8Array | Uint16Array | Uint32Array> {
  data: A;
  length = 0;

  constructor(
    private readonly make: (n: number) => A,
    initial = 1024,
  ) {
    this.data = make(initial);
  }

  private ensure(extra: number): void {
    const need = this.length + extra;
    if (need <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < need) cap *= 2;
    const next = this.make(cap);
    next.set(this.data.subarray(0, this.length) as never);
    this.data = next;
  }

  push(v: number): void {
    this.ensure(1);
    this.data[this.length++] = v;
  }

  append(src: ArrayLike<number>, start = 0, end = src.length): void {
    const n = end - start;
    if (n <= 0) return;
    this.ensure(n);
    if (ArrayBuffer.isView(src)) {
      this.data.set((src as unknown as A).subarray(start, end) as never, this.length);
    } else {
      for (let i = 0; i < n; i++) this.data[this.length + i] = src[start + i];
    }
    this.length += n;
  }

  view(): A {
    return this.data.subarray(0, this.length) as A;
  }
}

/** 逐行追加词条，最后序列化为 `.idx` 字节。 */
export class IdiomTableBuilder {
  private readonly sylStart = new Growable((n) => new Uint32Array(n));
  private readonly flags = new Growable((n) => new Uint8Array(n));
  private readonly scalars = new Growable((n) => new Uint32Array(n), 4096);
  private readonly sm = new Growable((n) => new Uint8Array(n), 4096);
  private readonly ym = new Growable((n) => new Uint16Array(n), 4096);
  private readonly tone = new Growable((n) => new Uint8Array(n), 4096);
  private readonly explStart = new Growable((n) => new Uint32Array(n));
  private readonly expl = new Growable((n) => new Uint8Array(n), 4096);
  private readonly smTable: string[] = [""];
  private readonly ymTable: string[] = [""];
  private readonly smIndex = new Map<string, number>([["", 0]]);
  private readonly ymIndex = new Map<string, number>([["", 0]]);
  private readonly translations = new Map<IdiomTable, { sm: Uint8Array; ym: Uint16Array }>();

  constructor() {
    this.sylStart.push(0);
    this.explStart.push(0);
  }

  get count(): number {
    return this.flags.length;
  }

  private internSM(s: string): number {
    const hit = this.smIndex.get(s);
    if (hit !== undefined) return hit;
    if (this.smTable.length >= 256) throw new Error("声母表超过 255 项");
    const v = this.smTable.length;
    this.smTable.push(s);
    this.smIndex.set(s, v);
    return v;
  }

  private internYM(s: string): number {
    const hit = this.ymIndex.get(s);
    if (hit !== undefined) return hit;
    if (this.ymTable.length >= 65536) throw new Error("韵母表过大");
    const v = this.ymTable.length;
    this.ymTable.push(s);
    this.ymIndex.set(s, v);
    return v;
  }

  private translation(table: IdiomTable): { sm: Uint8Array; ym: Uint16Array } {
    const hit = this.translations.get(table);
    if (hit) return hit;
    const sm = new Uint8Array(table.smStrings.length);
    const ym = new Uint16Array(table.ymStrings.length);
    table.smStrings.forEach((s, i) => (sm[i] = this.internSM(s)));
    table.ymStrings.forEach((s, i) => (ym[i] = this.internYM(s)));
    const t = { sm, ym };
    this.translations.set(table, t);
    return t;
  }

  /** 追加一条。`readings` 为 null 或 `flag != valid` 时，读音区位全部写 0。 */
  append(word: string, readings: readonly CharData[] | null, flag: number, explanation: string): void {
    const ws: number[] = [];
    for (const ch of word) ws.push(ch.codePointAt(0) as number);
    this.scalars.append(ws);
    if (flag === ReadingFlag.valid && readings !== null && readings.length === ws.length) {
      for (const r of readings) {
        this.sm.push(this.internSM(r.sm));
        this.ym.push(this.internYM(r.ym));
        this.tone.push(Math.max(0, Math.min(255, r.tone)));
      }
      this.flags.push(ReadingFlag.valid);
    } else {
      for (let i = 0; i < ws.length; i++) {
        this.sm.push(0);
        this.ym.push(0);
        this.tone.push(0);
      }
      this.flags.push(flag === ReadingFlag.valid ? ReadingFlag.invalid : flag);
    }
    this.sylStart.push(this.scalars.length);
    this.expl.append(utf8Encoder.encode(explanation));
    this.explStart.push(this.expl.length);
  }

  /**
   * 合并用：词面取自 `st`，读音取自 `rt`，释义取自 `et`。三者必须是同一个词（字数一致）。
   */
  appendRow(st: IdiomTable, sr: number, rt: IdiomTable, rr: number, et: IdiomTable, er: number): void {
    const n = st.length(sr);
    if (rt.length(rr) !== n) throw new Error("合并的两行字数不一致");
    const ss = st.start(sr);
    const rs = rt.start(rr);
    this.scalars.append(st.scalars, ss, ss + n);
    const tr = this.translation(rt);
    for (let k = 0; k < n; k++) {
      this.sm.push(tr.sm[rt.smCodes[rs + k]]);
      this.ym.push(tr.ym[rt.ymCodes[rs + k]]);
      this.tone.push(rt.tones[rs + k]);
    }
    this.flags.push(rt.flag(rr));
    this.sylStart.push(this.scalars.length);
    this.expl.append(et.explanationBytes(er));
    this.explStart.push(this.expl.length);
  }

  serialize(): Uint8Array {
    const count = this.count;
    const scalars = this.scalars.view();
    const sylStart = this.sylStart.view();

    // 词面哈希索引：按 (hash, row) 升序
    const hHi = new Uint32Array(count);
    const hLo = new Uint32Array(count);
    for (let i = 0; i < count; i++) {
      fnvScalars(scalars, sylStart[i], sylStart[i + 1]);
      hHi[i] = hashOut.hi;
      hLo[i] = hashOut.lo;
    }
    const order = new Uint32Array(count);
    for (let i = 0; i < count; i++) order[i] = i;
    order.sort((a, b) => {
      if (hHi[a] !== hHi[b]) return hHi[a] < hHi[b] ? -1 : 1;
      if (hLo[a] !== hLo[b]) return hLo[a] < hLo[b] ? -1 : 1;
      return a - b;
    });

    const encodeStrings = (strings: readonly string[]): Uint8Array => {
      const parts = strings.map((s) => utf8Encoder.encode(s));
      let total = 0;
      for (const p of parts) {
        if (p.length >= 256) throw new Error("字符串表项过长");
        total += 1 + p.length;
      }
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) {
        out[off++] = p.length;
        out.set(p, off);
        off += p.length;
      }
      return out;
    };
    const smBytes = encodeStrings(this.smTable);
    const ymBytes = encodeStrings(this.ymTable);

    const expl = this.expl.view();
    const l = makeLayout(
      count,
      scalars.length,
      this.smTable.length,
      this.ymTable.length,
      smBytes.length,
      ymBytes.length,
      expl.length,
    );

    const buffer = new ArrayBuffer(l.fileSize);
    const out = new Uint8Array(buffer);
    new Uint32Array(buffer, l.sylStartOff, count + 1).set(sylStart);
    new Uint8Array(buffer, l.flagsOff, count).set(this.flags.view());
    new Uint32Array(buffer, l.scalarsOff, scalars.length).set(scalars);
    new Uint8Array(buffer, l.smOff, scalars.length).set(this.sm.view());
    new Uint16Array(buffer, l.ymOff, scalars.length).set(this.ym.view());
    new Uint8Array(buffer, l.toneOff, scalars.length).set(this.tone.view());
    new Uint32Array(buffer, l.explStartOff, count + 1).set(this.explStart.view());
    const hashesOut = new Uint32Array(buffer, l.hashesOff, 2 * count);
    const rowsOut = new Uint32Array(buffer, l.hashRowsOff, count);
    for (let k = 0; k < count; k++) {
      const row = order[k];
      hashesOut[2 * k] = hLo[row];
      hashesOut[2 * k + 1] = hHi[row];
      rowsOut[k] = row;
    }
    out.set(smBytes, l.smTableOff);
    out.set(ymBytes, l.ymTableOff);
    out.set(expl, l.explBlobOff);

    const h32 = new Uint32Array(buffer, 0, 16);
    h32[0] = IdiomTable.magic;
    h32[1] = IdiomTable.formatVersion;
    h32[2] = l.count;
    h32[3] = l.totalChars;
    h32[4] = l.smCount;
    h32[5] = l.ymCount;
    h32[6] = l.smTableBytes;
    h32[7] = l.ymTableBytes;
    h32[8] = l.explBlobSize;
    h32[9] = 0;
    const indexWords = new Uint32Array(buffer, HEADER_SIZE, (l.explBlobOff - HEADER_SIZE) / 4);
    hashWords(indexWords, 0, indexWords.length / 2);
    h32[10] = hashOut.lo;
    h32[11] = hashOut.hi;
    h32[12] = l.fileSize;
    h32[13] = 0;
    return out;
  }
}
