// 差分测试：读 tests/fixtures/engine_golden.json（由桌面 TS 引擎在同一份合并词库上跑出的期望结果），
// 逐场景断言 total / first / digest（有 words 时再断言 words）。对应 Swift `DeduceGoldenTests.swift`。
//
// 夹具 schema（version 1）：
// {"version":1,"lexicon":"merged","scenarios":[{"id":"s0001","kind":"answer-consistent|noisy|edge",
//   "answer":"金瓯无缺","answerExcluded":true,"includePolyphones":false,"guesses":[…DeduceGuess…],
//   "total":123,"words":["…"],"first":[{"word":"…","pinyin":"带调号拼音"}],"digest":"16位小写hex"}]}
// · answer / answerExcluded / words 可缺省；words 仅在 total <= 300 时给出全部；first 最多 30 条。
// · digest：对按顺序的全部匹配词面，逐个喂入「词面 UTF-8 字节 + 0x0A」做 64 位 FNV-1a，输出 16 位小写 hex。
// · answerExcluded == true：桌面 TS 引擎本身会把答案刷掉的已知情形，结果应与 TS 一致，不因此判失败。
// · 拼音展示的已知分歧（TS 与 Rust 不一致，数据层跟随 Rust）：词库里的脏音节（含 [a-z:] 以外的字符，
//   如 "l埇"、"ɡ"(U+0261)、私有区字符）在 TS `markSyllable` 里因正则不匹配而原样保留数字调（"l埇5"），
//   Rust / Swift / 本实现则照常去掉 5 或标调（"l埇"、"ɡǒu"）。夹具由 TS 生成，所以这一类只在
//   「期望值 == 按 TS 规则渲染解析出的读音」时放行并计数，其余一律判失败。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeduceEngine } from "../../src/core/engine/engine";
import { decodeGuess, type CharData, type DeduceGuess } from "../../src/core/model/types";
import { markSyllable, toneDigit } from "../../src/core/pinyin/pinyin";
import { fixturesDir } from "./support/fsIO";
import { realLexicon } from "./support/engineSupport";

interface Scenario {
  id: string;
  kind?: string;
  answer?: string;
  answerExcluded?: boolean;
  includePolyphones?: boolean;
  guesses: DeduceGuess[];
  total: number;
  words?: string[];
  first?: { word: string; pinyin: string }[];
  digest?: string;
}

interface Golden {
  version: number;
  lexicon?: string;
  scenarios: Scenario[];
}

function loadGolden(name: string): Golden {
  const raw = JSON.parse(readFileSync(join(fixturesDir, name), "utf-8")) as {
    version: number;
    lexicon?: string;
    scenarios: (Omit<Scenario, "guesses"> & { guesses: unknown[] })[];
  };
  return {
    version: raw.version,
    lexicon: raw.lexicon,
    scenarios: raw.scenarios.map((s) => ({ ...s, guesses: s.guesses.map(decodeGuess) })),
  };
}

/** 64 位 FNV-1a：每个词面的 UTF-8 字节后追加 0x0A。用高低 32 位实现。 */
function deduceGoldenDigest(words: readonly string[]): string {
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  const step = (byte: number): void => {
    lo = (lo ^ byte) >>> 0;
    const p = lo * 435;
    const carry = Math.floor(p / 4294967296);
    hi = (hi * 435 + carry + ((lo << 8) >>> 0)) >>> 0;
    lo = p >>> 0;
  };
  const enc = new TextEncoder();
  for (const w of words) {
    for (const b of enc.encode(w)) step(b);
    step(0x0a);
  }
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}

/** TS `markSyllable` 的行为：音节（去空白、转小写后）不是 `^[a-z:]+[1-5]$` 就原样返回，否则同本实现。 */
function deduceTSMarkSyllable(syl: string): string {
  const raw = syl.replace(/^[\s\uFEFF]+|[\s\uFEFF]+$/g, "");
  const u = Array.from(raw.toLowerCase());
  const last = u[u.length - 1];
  if (u.length < 2 || last === undefined || !"12345".includes(last)) return raw;
  for (const c of u.slice(0, -1)) {
    if (!((c >= "a" && c <= "z") || c === ":")) return raw;
  }
  return markSyllable(syl);
}

function deduceTSMarkedPinyin(chars: readonly CharData[]): string {
  return chars.map((c) => deduceTSMarkSyllable(c.py + toneDigit(c.tone))).join(" ");
}

function firstDiff(expected: readonly string[], actual: readonly string[]): string {
  const n = Math.min(expected.length, actual.length);
  for (let i = 0; i < n; i++) {
    if (expected[i] !== actual[i]) return `第 ${i} 条不同：期望 ${expected[i]}，实际 ${actual[i]}`;
  }
  if (expected.length !== actual.length) {
    const longer = expected.length > actual.length ? "期望多出" : "实际多出";
    const extra = (expected.length > actual.length ? expected : actual)[n];
    return `长度不同：期望 ${expected.length}，实际 ${actual.length}；${longer}的第一条是 ${extra}`;
  }
  return "无差异";
}

function runGolden(fixture: string, requireAnswerKept: boolean): void {
  const { table, poly } = realLexicon();
  const golden = loadGolden(fixture);
  expect(golden.version, "夹具版本不受支持").toBe(1);
  expect(golden.lexicon ?? "merged").toBe("merged");
  expect(golden.scenarios.length, "夹具里没有场景").toBeGreaterThan(0);

  const failures: string[] = [];
  let checkedWords = 0;
  let excludedAnswers = 0;
  let tsPinyinDivergences = 0;
  const fail = (s: Scenario, msg: string): void => {
    failures.push(`[${s.id}${s.kind ? "/" + s.kind : ""}] ${msg}`);
  };

  for (const s of golden.scenarios) {
    const include = s.includePolyphones ?? false;
    const res = DeduceEngine.filter({ table, guesses: s.guesses, polyMap: poly, limit: 30, includePolyphones: include });
    const words = DeduceEngine.matchingWords({ table, guesses: s.guesses, polyMap: poly, includePolyphones: include });
    if (res === null || words === null) {
      fail(s, "引擎返回 null");
      continue;
    }

    // total（filter 与 matchingWords 必须一致）
    if (res.total !== s.total) {
      const hint = s.words ? "；" + firstDiff(s.words, words) : "";
      fail(s, `total 不符：期望 ${s.total}，实际 ${res.total}${hint}`);
    }
    if (words.length !== res.total) fail(s, `matchingWords 数量 ${words.length} 与 filter.total ${res.total} 不一致`);

    // first：词面与带调号拼音
    if (s.first) {
      const n = Math.min(s.first.length, res.items.length);
      for (let i = 0; i < n; i++) {
        const want = s.first[i];
        const got = res.items[i];
        if (want.word !== got.word) {
          fail(s, `first[${i}] 词面不符：期望 ${want.word}，实际 ${got.word}`);
          break;
        }
        if (want.pinyin === got.pinyin) continue;
        if (want.pinyin === deduceTSMarkedPinyin(got.chars)) {
          tsPinyinDivergences += 1; // 脏音节：TS 与 Rust 的 markSyllable 分歧，见文件头注释
          continue;
        }
        fail(s, `first[${i}] 拼音不符：${want.word} 期望 ${want.pinyin}，实际 ${got.pinyin}`);
        break;
      }
      if (res.items.length < s.first.length && res.total >= s.first.length) {
        fail(s, `items 只有 ${res.items.length} 条，期望至少 ${s.first.length} 条`);
      }
      if (s.first.length > 30) fail(s, "夹具 first 超过 30 条，schema 不符");
    }

    // words（total <= 300 时给出全部）
    if (s.words) {
      checkedWords += 1;
      if (JSON.stringify(s.words) !== JSON.stringify(words)) fail(s, "words 不符：" + firstDiff(s.words, words));
    }

    // digest
    if (s.digest !== undefined) {
      const got = deduceGoldenDigest(words);
      if (got !== s.digest) fail(s, `digest 不符：期望 ${s.digest}，实际 ${got}`);
    }

    // 答案一致性：桌面引擎没有刷掉答案（answerExcluded == false）的场景，这里也不能刷掉
    if (s.answer !== undefined && s.answerExcluded === false && !words.includes(s.answer)) {
      fail(s, `答案 ${s.answer} 被误杀（TS 结果里保留了它）`);
    }
    // 回归夹具：每个带答案的场景都必须保留答案（这些场景在补丁前都会被桌面引擎误杀）
    if (requireAnswerKept && s.answer !== undefined && !words.includes(s.answer)) {
      fail(s, `答案 ${s.answer} 被误杀；该夹具要求所有场景保留答案`);
    }
    if (s.answerExcluded === true) excludedAnswers += 1;
  }

  console.log(
    `[DeduceGolden] ${fixture}：场景 ${golden.scenarios.length}，含 words 的 ${checkedWords}，TS 已知刷掉答案 ${excludedAnswers}，` +
      `脏音节拼音分歧(TS≠Rust) ${tsPinyinDivergences} 条，失败 ${failures.length}`,
  );
  expect(failures.slice(0, 30), `共 ${failures.length} 个场景与夹具不一致（最多显示前 30 条）`).toEqual([]);
}

describe("DeduceGolden", () => {
  it("TS markSyllable 仿真", () => {
    expect(deduceTSMarkSyllable("l埇5")).toBe("l埇5"); // 脏音节：原样
    expect(deduceTSMarkSyllable("ɡou3")).toBe("ɡou3");
    expect(deduceTSMarkSyllable("\uE4B45")).toBe("\uE4B45");
    expect(deduceTSMarkSyllable("5")).toBe("5");
    expect(deduceTSMarkSyllable("xing5")).toBe("xing");
    expect(deduceTSMarkSyllable("jin1")).toBe("jīn");
    expect(deduceTSMarkSyllable("lv4")).toBe("lǜ");
    expect(deduceTSMarkSyllable("Jin1")).toBe("jīn");
    expect(markSyllable("l埇5")).toBe("l埇"); // 本实现 / Rust：照常去掉 5
  });

  it("digest 定义", () => {
    // FNV-1a 64：空序列 → offset basis；"a\n" 手算对照
    expect(deduceGoldenDigest([])).toBe("cbf29ce484222325");
    let h = 0xcbf29ce484222325n;
    for (const b of [0x61n, 0x0an]) h = BigInt.asUintN(64, (h ^ b) * 0x100000001b3n);
    expect(deduceGoldenDigest(["a"])).toBe(h.toString(16).padStart(16, "0"));
    expect(deduceGoldenDigest(["ab"])).not.toBe(deduceGoldenDigest(["a", "b"])); // 分隔符 0x0A 必须参与哈希
  });

  it("engine_golden.json 全部场景与桌面 TS 引擎一致", () => {
    runGolden("engine_golden.json", false);
  });

  /**
   * 锁字位误杀回归：输入固定（补丁前桌面引擎会把答案刷掉的 6 个场景），期望 = 桌面 TS + 补丁。
   * 除了与夹具逐项一致，还要求每个带答案的场景都保留答案。
   */
  it("engine_locked_regression.json 全部场景一致且保留答案", () => {
    runGolden("engine_locked_regression.json", true);
  });
});
