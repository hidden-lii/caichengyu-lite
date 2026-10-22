// 筛选引擎的热路径：把字符串约束编译成小整数编码，逐行直接读词库的列式数组匹配。
// 对应 Swift `Engine/DeducePlan.swift`。
//
// 编码规则：
//   · 声母 / 韵母码沿用词库内字符串表的下标（0 恒为空串）；约束或多音表里出现表外字符串时，在表尾追加新码。
//   · 声调码：0...255 即声调本身（词库声调是 u8），表外的声调值（如猜测里的 7、-1）追加到 256 之后。
//   · 字用 Unicode 码点比较；不是恰好一个码点的字符串永远匹配不上任何词库字，编译时直接处理。
// 非匹配行零堆分配；多音展开用每次扫描自带的 scratch 缓冲区。

import type { CharData, PolyphoneMap } from "../model/types";
import { IdiomTable, ReadingFlag } from "../lexicon/idiomTable";
import { scalarToString, singleScalar } from "../text";
import type { DeduceMerged } from "./constraints";

/** 没有固定字 */
const NO_CHAR = -1;

/** 每次扫描一份的临时缓冲区（各数组按位置下标；候选按 `pos * maxR + k`）。 */
export interface DeduceScratch {
  /** 当前行各位选定的读音（匹配成功后即「解析后的读音」） */
  chosenSm: Int32Array;
  chosenYm: Int32Array;
  chosenTone: Int32Array;
  /** 多音表读音的 py 在 `DeducePlan.polyPy` 里的下标；-1 表示 py = 声母 + 韵母（词库读音） */
  chosenPy: Int32Array;
  /** 每位的可行读音 */
  candSm: Int32Array;
  candYm: Int32Array;
  candTone: Int32Array;
  candPy: Int32Array;
  cnt: Int32Array;
  idx: Int32Array;
}

/** 一次筛选的编译结果，同时承载逐行匹配。 */
export class DeducePlan {
  readonly table: IdiomTable;
  /** 约束本身自相矛盾（如要求的字不是单个字符），不可能有匹配 */
  readonly impossible: boolean;
  readonly smNames: string[];
  readonly ymNames: string[];
  readonly toneExtra: number[];
  readonly polyPy: string[];

  // —— 匹配用的只读数据 ——
  private readonly len: number;
  private readonly nPos: number;
  private readonly nSm: number;
  private readonly nYm: number;
  private readonly nTone: number;
  private readonly hasExclude: boolean;
  private readonly hasPhoneticPresent: boolean;

  private readonly fixedChar: Int32Array;
  private readonly fixedSm: Int32Array;
  private readonly fixedYm: Int32Array;
  private readonly fixedTone: Int32Array;

  private readonly absentSm: Uint8Array;
  private readonly absentYm: Uint8Array;
  private readonly absentTone: Uint8Array;
  private readonly exclSm: Uint8Array;
  private readonly exclYm: Uint8Array;
  private readonly exclTone: Uint8Array;

  private readonly absentChars: Int32Array;
  private readonly presentChars: Int32Array;
  private readonly presentCharAt: Int32Array;

  /** 音素「偏」：0 = 声母，1 = 韵母，2 = 声调，3 = 声韵组合 */
  private readonly phKind: Uint8Array;
  private readonly phNotAt: Int32Array;
  private readonly phSm: Int32Array;
  private readonly phYm: Int32Array;
  /** 声调码；combo 时 -1 表示不含调 */
  private readonly phTone: Int32Array;

  private readonly polyTable: Int32Array;
  private readonly polyStart: Int32Array;
  private readonly polyCount: Int32Array;
  private readonly polyRSm: Int32Array;
  private readonly polyRYm: Int32Array;
  private readonly polyRTone: Int32Array;
  private readonly polyRPy: Int32Array;
  /** 去重用的声调键：1...5，其余按 5（对应 Rust 的 reading_key） */
  private readonly polyRTk: Int32Array;
  private readonly usePoly: boolean;

  private readonly maxR: number;
  private readonly scratchPositions: number;

  /** `polyMap` 为 null 或 `usePoly == false` 时只用词库读音。 */
  constructor(table: IdiomTable, m: DeduceMerged, polyMap: PolyphoneMap | null, usePoly: boolean) {
    const smNames = table.smStrings.slice();
    const ymNames = table.ymStrings.slice();
    const smIndex = new Map<string, number>();
    const ymIndex = new Map<string, number>();
    smNames.forEach((s, i) => {
      if (!smIndex.has(s)) smIndex.set(s, i);
    });
    ymNames.forEach((s, i) => {
      if (!ymIndex.has(s)) ymIndex.set(s, i);
    });
    const toneExtra: number[] = [];
    const toneIndex = new Map<number, number>();

    const smCode = (s: string): number => {
      const v = smIndex.get(s);
      if (v !== undefined) return v;
      const nv = smNames.length;
      smNames.push(s);
      smIndex.set(s, nv);
      return nv;
    };
    const ymCode = (s: string): number => {
      const v = ymIndex.get(s);
      if (v !== undefined) return v;
      const nv = ymNames.length;
      ymNames.push(s);
      ymIndex.set(s, nv);
      return nv;
    };
    const toneCode = (t: number): number => {
      if (t >= 0 && t <= 255) return t;
      const v = toneIndex.get(t);
      if (v !== undefined) return v;
      const nv = 256 + toneExtra.length;
      toneExtra.push(t);
      toneIndex.set(t, nv);
      return nv;
    };

    let impossible = false;

    // 固定位
    const nPos = m.fixed.length;
    const fixedChar = new Int32Array(nPos).fill(NO_CHAR);
    const fixedSm = new Int32Array(nPos).fill(-1);
    const fixedYm = new Int32Array(nPos).fill(-1);
    const fixedTone = new Int32Array(nPos).fill(-1);
    m.fixed.forEach((f, i) => {
      if (f === null) return;
      if (f.c !== undefined) {
        const v = singleScalar(f.c);
        if (v !== null) fixedChar[i] = v;
        else impossible = true;
      }
      if (f.sm !== undefined) fixedSm[i] = smCode(f.sm);
      if (f.ym !== undefined) fixedYm[i] = ymCode(f.ym);
      if (f.tone !== undefined) fixedTone[i] = toneCode(f.tone);
    });

    // 全局无
    const absentSmCodes = Array.from(m.absentSm, smCode);
    const absentYmCodes = Array.from(m.absentYm, ymCode);
    const absentToneCodes = Array.from(m.absentTone, toneCode);
    const absentCharList: number[] = [];
    for (const c of m.absentChar) {
      const v = singleScalar(c);
      if (v !== null) absentCharList.push(v);
    }

    // 位置排除（零声母的 sm 排除不可能产生，这里再兜一次底）
    const exclusions: { kind: "sm" | "ym" | "tone"; at: number; code: number }[] = [];
    for (const e of m.excludeAt) {
      switch (e.kind) {
        case "sm":
          if (e.valueStr.length === 0) continue;
          exclusions.push({ kind: "sm", at: e.at, code: smCode(e.valueStr) });
          break;
        case "ym":
          exclusions.push({ kind: "ym", at: e.at, code: ymCode(e.valueStr) });
          break;
        case "tone":
          exclusions.push({ kind: "tone", at: e.at, code: toneCode(e.valueTone) });
          break;
      }
    }

    // 偏
    const presentCharValues: number[] = [];
    const presentCharAtList: number[] = [];
    const phKind: number[] = [];
    const phNotAt: number[] = [];
    const phSm: number[] = [];
    const phYm: number[] = [];
    const phTone: number[] = [];
    for (const p of m.present) {
      switch (p.kind) {
        case "char": {
          const v = singleScalar(p.valueStr);
          if (v !== null) {
            presentCharValues.push(v);
            presentCharAtList.push(p.notAt);
          } else {
            impossible = true; // 别处永远找不到这个字
          }
          break;
        }
        case "sm":
          phKind.push(0);
          phNotAt.push(p.notAt);
          phSm.push(smCode(p.valueStr));
          phYm.push(0);
          phTone.push(0);
          break;
        case "ym":
          phKind.push(1);
          phNotAt.push(p.notAt);
          phSm.push(0);
          phYm.push(ymCode(p.valueStr));
          phTone.push(0);
          break;
        case "tone":
          phKind.push(2);
          phNotAt.push(p.notAt);
          phSm.push(0);
          phYm.push(0);
          phTone.push(toneCode(p.valueTone));
          break;
        case "combo":
          phKind.push(3);
          phNotAt.push(p.notAt);
          phSm.push(smCode(p.valueStr));
          phYm.push(ymCode(p.valueYm));
          phTone.push(p.valueTone > 0 ? toneCode(p.valueTone) : -1);
          break;
      }
    }

    // 多音表：同一字内按 py+调去重，保留首次出现的顺序（默认读音在前）。
    // 与词库读音的去重在匹配时按 (声母, 韵母, 调键) 比较——词库与多音表的读音都由同一个
    // 拼音拆分函数产生，py == 声母 + 韵母 且拆分唯一，所以与 Rust 按 py+调去重等价。
    const polyPy: string[] = [];
    let polyTableValues: Int32Array = new Int32Array(0);
    const polyStartList: number[] = [];
    const polyCountList: number[] = [];
    const rSm: number[] = [];
    const rYm: number[] = [];
    const rTone: number[] = [];
    const rPy: number[] = [];
    const rTk: number[] = [];
    let maxR = 1;
    if (usePoly && polyMap !== null && polyMap.size > 0) {
      const entries: { scalar: number; list: { sm: number; ym: number; tone: number; py: number; tk: number }[] }[] = [];
      let maxScalar = 0;
      for (const [key, entry] of polyMap) {
        const scalar = singleScalar(key);
        if (scalar === null) continue;
        const seen = new Set<string>();
        const list: { sm: number; ym: number; tone: number; py: number; tk: number }[] = [];
        for (const r of [entry.default, ...entry.alts]) {
          const tk = r.tone >= 1 && r.tone <= 5 ? r.tone : 5;
          const dedupKey = r.py + String(tk);
          if (seen.has(dedupKey)) continue;
          seen.add(dedupKey);
          polyPy.push(r.py);
          list.push({ sm: smCode(r.sm), ym: ymCode(r.ym), tone: toneCode(r.tone), py: polyPy.length - 1, tk });
        }
        if (list.length === 0) continue;
        entries.push({ scalar, list });
        if (scalar > maxScalar) maxScalar = scalar;
      }
      if (entries.length > 0) {
        polyTableValues = new Int32Array(maxScalar + 1).fill(-1);
        entries.forEach((e, slot) => {
          polyTableValues[e.scalar] = slot;
          polyStartList.push(rSm.length);
          polyCountList.push(e.list.length);
          for (const r of e.list) {
            rSm.push(r.sm);
            rYm.push(r.ym);
            rTone.push(r.tone);
            rPy.push(r.py);
            rTk.push(r.tk);
          }
          maxR = Math.max(maxR, 1 + e.list.length);
        });
      }
    }

    // 码空间在此定型，开始填表
    const nSm = smNames.length;
    const nYm = ymNames.length;
    const nTone = 256 + toneExtra.length;

    const absSm = new Uint8Array(nSm);
    const absYm = new Uint8Array(nYm);
    const absTone = new Uint8Array(nTone);
    for (const c of absentSmCodes) absSm[c] = 1;
    for (const c of absentYmCodes) absYm[c] = 1;
    for (const c of absentToneCodes) absTone[c] = 1;

    const exSm = new Uint8Array(Math.max(nPos * nSm, 1));
    const exYm = new Uint8Array(Math.max(nPos * nYm, 1));
    const exTone = new Uint8Array(Math.max(nPos * nTone, 1));
    for (const e of exclusions) {
      if (e.at >= nPos) continue;
      switch (e.kind) {
        case "sm":
          exSm[e.at * nSm + e.code] = 1;
          break;
        case "ym":
          exYm[e.at * nYm + e.code] = 1;
          break;
        case "tone":
          exTone[e.at * nTone + e.code] = 1;
          break;
      }
    }

    let scratchPositions = m.len;
    if (scratchPositions === 0) {
      for (let i = 0; i < table.count; i++) scratchPositions = Math.max(scratchPositions, table.length(i));
    }

    this.table = table;
    this.impossible = impossible;
    this.smNames = smNames;
    this.ymNames = ymNames;
    this.toneExtra = toneExtra;
    this.polyPy = polyPy;
    this.len = m.len;
    this.nPos = nPos;
    this.nSm = nSm;
    this.nYm = nYm;
    this.nTone = nTone;
    this.hasExclude = exclusions.length > 0;
    this.hasPhoneticPresent = phKind.length > 0;
    this.fixedChar = fixedChar;
    this.fixedSm = fixedSm;
    this.fixedYm = fixedYm;
    this.fixedTone = fixedTone;
    this.absentSm = absSm;
    this.absentYm = absYm;
    this.absentTone = absTone;
    this.exclSm = exSm;
    this.exclYm = exYm;
    this.exclTone = exTone;
    this.absentChars = Int32Array.from(absentCharList);
    this.presentChars = Int32Array.from(presentCharValues);
    this.presentCharAt = Int32Array.from(presentCharAtList);
    this.phKind = Uint8Array.from(phKind);
    this.phNotAt = Int32Array.from(phNotAt);
    this.phSm = Int32Array.from(phSm);
    this.phYm = Int32Array.from(phYm);
    this.phTone = Int32Array.from(phTone);
    this.polyTable = polyTableValues;
    this.polyStart = Int32Array.from(polyStartList);
    this.polyCount = Int32Array.from(polyCountList);
    this.polyRSm = Int32Array.from(rSm);
    this.polyRYm = Int32Array.from(rYm);
    this.polyRTone = Int32Array.from(rTone);
    this.polyRPy = Int32Array.from(rPy);
    this.polyRTk = Int32Array.from(rTk);
    this.usePoly = rSm.length > 0;
    this.maxR = maxR;
    this.scratchPositions = scratchPositions;
  }

  makeScratch(): DeduceScratch {
    const n = Math.max(this.scratchPositions, 1);
    const c = n * Math.max(this.maxR, 1);
    return {
      chosenSm: new Int32Array(n),
      chosenYm: new Int32Array(n),
      chosenTone: new Int32Array(n),
      chosenPy: new Int32Array(n),
      candSm: new Int32Array(c),
      candYm: new Int32Array(c),
      candTone: new Int32Array(c),
      candPy: new Int32Array(c),
      cnt: new Int32Array(n),
      idx: new Int32Array(n),
    };
  }

  /** 把整数编码的读音还原成 `CharData`。 */
  charData(scalar: number, sm: number, ym: number, tone: number, py: number): CharData {
    const smStr = this.smNames[sm];
    const ymStr = this.ymNames[ym];
    return {
      c: scalarToString(scalar),
      py: py >= 0 ? this.polyPy[py] : smStr + ymStr,
      sm: smStr,
      ym: ymStr,
      tone: tone < 256 ? tone : this.toneExtra[tone - 256],
    };
  }

  /** 把 `sc.chosen*[0..<n]`（第 `row` 行刚刚匹配成功）还原成逐字读音。 */
  resolvedChars(row: number, sc: DeduceScratch): CharData[] {
    const table = this.table;
    const s = table.sylStart[row];
    const n = table.sylStart[row + 1] - s;
    const out: CharData[] = new Array(n);
    for (let p = 0; p < n; p++) {
      out[p] = this.charData(table.scalars[s + p], sc.chosenSm[p], sc.chosenYm[p], sc.chosenTone[p], sc.chosenPy[p]);
    }
    return out;
  }

  // MARK: - 匹配

  private polySlot(scalar: number): number {
    return scalar < this.polyTable.length ? this.polyTable[scalar] : -1;
  }

  /** 读音是否可行：满足该位固定的声/韵/调；非锁字位还须不踩全局无与该位排除。 */
  private viable(p: number, sm: number, ym: number, tone: number): boolean {
    if (p < this.nPos) {
      const fs = this.fixedSm[p];
      if (fs >= 0 && sm !== fs) return false;
      const fy = this.fixedYm[p];
      if (fy >= 0 && ym !== fy) return false;
      const ft = this.fixedTone[p];
      if (ft >= 0 && tone !== ft) return false;
      // 锁字位（该位字已被「对」固定）不查全局无 / 位置排除
      if (this.fixedChar[p] !== NO_CHAR) return true;
    }
    // 零声母（码 0）不是独立音素，不能当「全局无声母」
    if (sm !== 0 && this.absentSm[sm] !== 0) return false;
    if (this.absentYm[ym] !== 0) return false;
    if (this.absentTone[tone] !== 0) return false;
    if (this.hasExclude && p < this.nPos) {
      if (this.exclSm[p * this.nSm + sm] !== 0) return false;
      if (this.exclYm[p * this.nYm + ym] !== 0) return false;
      if (this.exclTone[p * this.nTone + tone] !== 0) return false;
    }
    return true;
  }

  private phoneticMatches(k: number, sm: number, ym: number, tone: number): boolean {
    switch (this.phKind[k]) {
      case 0:
        return sm === this.phSm[k];
      case 1:
        return ym === this.phYm[k];
      case 2:
        return tone === this.phTone[k];
      default: {
        const t = this.phTone[k];
        return sm === this.phSm[k] && ym === this.phYm[k] && (t < 0 || tone === t);
      }
    }
  }

  /** 一组选定读音是否满足全部音素「偏」：本位不得匹配，且别处至少有一位匹配。 */
  private presentSatisfied(sc: DeduceScratch, n: number): boolean {
    const count = this.phKind.length;
    for (let k = 0; k < count; k++) {
      const at = this.phNotAt[k];
      if (at >= n) continue; // 越界约束（猜测字数不一致）忽略，不崩溃
      if (this.phoneticMatches(k, sc.chosenSm[at], sc.chosenYm[at], sc.chosenTone[at])) return false;
      let found = false;
      for (let j = 0; j < n; j++) {
        if (j !== at && this.phoneticMatches(k, sc.chosenSm[j], sc.chosenYm[j], sc.chosenTone[j])) {
          found = true;
          break;
        }
      }
      if (!found) return false;
    }
    return true;
  }

  /** 第 `row` 行是否满足全部约束。成功时 `sc.chosen*[0..<n]` 为解析后的各位读音。 */
  match(row: number, sc: DeduceScratch): boolean {
    const table = this.table;
    const sylStart = table.sylStart;
    const s = sylStart[row];
    const n = sylStart[row + 1] - s;
    if (this.len > 0 && n !== this.len) return false;
    if (table.flags[row] !== ReadingFlag.valid) return false;

    const scalars = table.scalars;
    const nPos = this.nPos;

    // 固定字
    const fixedChar = this.fixedChar;
    const m = n < nPos ? n : nPos;
    let p = 0;
    while (p < m) {
      const f = fixedChar[p];
      if (f !== NO_CHAR && scalars[s + p] !== f) return false;
      p += 1;
    }

    // 字「偏」：别处须有该字，且本位不能是它
    const presentCharCount = this.presentChars.length;
    let k = 0;
    while (k < presentCharCount) {
      const at = this.presentCharAt[k];
      if (at < n) {
        const v = this.presentChars[k];
        if (scalars[s + at] === v) return false;
        let found = false;
        let j = 0;
        while (j < n) {
          if (j !== at && scalars[s + j] === v) {
            found = true;
            break;
          }
          j += 1;
        }
        if (!found) return false;
      }
      k += 1;
    }

    // 字「无」
    const absentCharCount = this.absentChars.length;
    k = 0;
    while (k < absentCharCount) {
      const v = this.absentChars[k];
      let j = 0;
      while (j < n) {
        if (scalars[s + j] === v) return false;
        j += 1;
      }
      k += 1;
    }

    // 读音
    let anyPoly = false;
    if (this.usePoly) {
      p = 0;
      while (p < n) {
        if (this.polySlot(scalars[s + p]) >= 0) {
          anyPoly = true;
          break;
        }
        p += 1;
      }
    }

    const smCodes = table.smCodes;
    const ymCodes = table.ymCodes;
    const tones = table.tones;

    if (!anyPoly) {
      p = 0;
      while (p < n) {
        const sm = smCodes[s + p];
        const ym = ymCodes[s + p];
        const tone = tones[s + p];
        if (!this.viable(p, sm, ym, tone)) return false;
        sc.chosenSm[p] = sm;
        sc.chosenYm[p] = ym;
        sc.chosenTone[p] = tone;
        sc.chosenPy[p] = -1;
        p += 1;
      }
      return this.hasPhoneticPresent ? this.presentSatisfied(sc, n) : true;
    }

    // 多音展开：每位 = 词库读音 + 多音表其余读音，再按可行性过滤；只要存在一种读法即可
    const maxR = this.maxR;
    p = 0;
    while (p < n) {
      const base = p * maxR;
      let c = 0;
      const t = tones[s + p];
      const sm0 = smCodes[s + p];
      const ym0 = ymCodes[s + p];
      if (this.viable(p, sm0, ym0, t)) {
        sc.candSm[base] = sm0;
        sc.candYm[base] = ym0;
        sc.candTone[base] = t;
        sc.candPy[base] = -1;
        c = 1;
      }
      const slot = this.polySlot(scalars[s + p]);
      if (slot >= 0) {
        const tk0 = t >= 1 && t <= 5 ? t : 5;
        const st = this.polyStart[slot];
        const pc = this.polyCount[slot];
        let q = 0;
        while (q < pc) {
          const ri = st + q;
          q += 1;
          const rsm = this.polyRSm[ri];
          const rym = this.polyRYm[ri];
          if (rsm === sm0 && rym === ym0 && this.polyRTk[ri] === tk0) continue;
          const rtone = this.polyRTone[ri];
          if (this.viable(p, rsm, rym, rtone)) {
            sc.candSm[base + c] = rsm;
            sc.candYm[base + c] = rym;
            sc.candTone[base + c] = rtone;
            sc.candPy[base + c] = this.polyRPy[ri];
            c += 1;
          }
        }
      }
      if (c === 0) return false;
      sc.cnt[p] = c;
      sc.idx[p] = 0;
      p += 1;
    }

    // 字典序枚举各位读音组合（末位变化最快），取第一个满足全部「偏」的赋值
    while (true) {
      p = 0;
      while (p < n) {
        const ci = p * maxR + sc.idx[p];
        sc.chosenSm[p] = sc.candSm[ci];
        sc.chosenYm[p] = sc.candYm[ci];
        sc.chosenTone[p] = sc.candTone[ci];
        sc.chosenPy[p] = sc.candPy[ci];
        p += 1;
      }
      if (!this.hasPhoneticPresent || this.presentSatisfied(sc, n)) return true;
      let q = n - 1;
      while (q >= 0) {
        sc.idx[q] += 1;
        if (sc.idx[q] < sc.cnt[q]) break;
        sc.idx[q] = 0;
        q -= 1;
      }
      if (q < 0) return false;
    }
  }
}
