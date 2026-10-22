// 词库管线差分：烘焙出的 9 个 .idx 按默认优先级合并后，必须与 TS 管线生成的
// `tests/fixtures/lexicon_default.tsv` 逐行一致（词、顺序、数字调拼音、释义字节数）。
// 对应 Swift `LexiconPipelineGoldenTests.swift`。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LexiconCatalog, LexiconMerger } from "../../src/core/lexicon/catalog";
import { IdiomTable } from "../../src/core/lexicon/idiomTable";
import { charsToDigitPinyin } from "../../src/core/pinyin/pinyin";
import { fixturesDir, publicDir } from "./support/fsIO";

describe("LexiconPipelineGolden", () => {
  it("默认全选合并结果与 TS 管线逐行一致", () => {
    const tsv = readFileSync(join(fixturesDir, "lexicon_default.tsv"), "utf-8");
    const tables = LexiconCatalog.defaultSelection.map((id) => {
      const raw = readFileSync(join(publicDir, `lexicon/${id}.idx`));
      return IdiomTable.open(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
    });
    const merged = IdiomTable.open(LexiconMerger.merge(tables).builder.serialize());

    const lines = tsv.split("\n").filter((l) => l.length > 0);
    expect(merged.count, "合并后条数与 TSV 行数不一致").toBe(lines.length);

    const mismatches: string[] = [];
    for (let i = 0; i < lines.length && i < merged.count; i++) {
      const cols = lines[i].split("\t");
      if (cols.length !== 3) {
        mismatches.push(`第 ${i} 行 TSV 格式不对`);
        continue;
      }
      const word = merged.word(i);
      const digit = charsToDigitPinyin(merged.chars(i));
      const explLen = merged.explanationBytes(i).length;
      if (word !== cols[0] || digit !== cols[1] || String(explLen) !== cols[2]) {
        mismatches.push(`第 ${i} 行：本实现=(${word}, ${digit}, ${explLen}) TS=(${cols[0]}, ${cols[1]}, ${cols[2]})`);
        if (mismatches.length >= 10) break;
      }
    }
    expect(mismatches, "与 TS 管线不一致（最多列 10 条）").toEqual([]);
  });
});
