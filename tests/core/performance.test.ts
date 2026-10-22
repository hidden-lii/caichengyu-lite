// 筛选性能：对真实合并词库（约 6.7 万条）做 1~4 条猜测的 filter。对应 Swift `DeduceEnginePerformanceTests.swift`。
// 这里只断言宽松的耗时上限（目标：一次筛选 < 100ms，实测通常只要几毫秒），并把数字打印出来供报告引用。

import { describe, expect, it } from "vitest";
import { DeduceEngine } from "../../src/core/engine/engine";
import { LexiconStore } from "../../src/core/lexicon/store";
import type { DeduceGuess } from "../../src/core/model/types";
import { FsDataIO } from "./support/fsIO";
import { DeduceScenarioMaker, TestRNG, deduceGuessFromSlots, deduceMark, realLexicon } from "./support/engineSupport";

function scenarios(perCount: number): Map<number, DeduceGuess[][]> {
  const { table } = realLexicon();
  const rng = new TestRNG(424242);
  const fourChar: number[] = [];
  for (let i = 0; i < table.count; i++) if (table.length(i) === 4) fourChar.push(i);
  const out = new Map<number, DeduceGuess[][]>();
  for (let count = 1; count <= 4; count++) {
    const list: DeduceGuess[][] = [];
    while (list.length < perCount) {
      const answer = rng.pick(fourChar);
      const gs: DeduceGuess[] = [];
      for (let k = 0; k < count; k++) {
        const g = DeduceScenarioMaker.makeGuess(table, rng.pick(fourChar), answer, 0, rng);
        if (g) gs.push(g);
      }
      if (gs.length === count) list.push(gs);
    }
    out.set(count, list);
  }
  return out;
}

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const pct = (xs: number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((s.length * p) / 100))];
};

describe("DeduceEngine · 性能", () => {
  it("典型筛选延迟（同步，一次扫描）", () => {
    const { table, poly } = realLexicon();
    const sets = scenarios(25);
    // 预热
    DeduceEngine.filter({ table, guesses: sets.get(1)![0], polyMap: poly });

    let worstMedian = 0;
    let worstMax = 0;
    for (let count = 1; count <= 4; count++) {
      for (const include of [false, true]) {
        const samples: number[] = [];
        const totals: number[] = [];
        for (const gs of sets.get(count)!) {
          const t0 = performance.now();
          const r = DeduceEngine.filter({ table, guesses: gs, polyMap: poly, limit: 200, includePolyphones: include });
          samples.push(performance.now() - t0);
          totals.push(r?.total ?? -1);
        }
        const med = median(samples);
        worstMedian = Math.max(worstMedian, med);
        worstMax = Math.max(worstMax, ...samples);
        const avgTotal = Math.round(totals.reduce((a, b) => a + b, 0) / totals.length);
        console.log(
          `[DeducePerf] rows=${table.count} guesses=${count} includePoly=${include} median=${med.toFixed(2)}ms ` +
            `p95=${pct(samples, 95).toFixed(2)}ms max=${Math.max(...samples).toFixed(2)}ms avgTotal=${avgTotal}`,
        );
      }
    }
    console.log(`[DeducePerf] 同步筛选：最差中位数 ${worstMedian.toFixed(2)}ms，最差单次 ${worstMax.toFixed(2)}ms`);
    expect(worstMedian).toBeLessThan(100);
  });

  it("最慢的一类：保底展开要完整扫描两遍；matchingWords", () => {
    const { table, poly } = realLexicon();
    const sets = scenarios(10);
    DeduceEngine.matchingWords({ table, guesses: sets.get(1)![0], polyMap: poly });

    const samples: number[] = [];
    for (const gs of sets.get(2)!) {
      const t0 = performance.now();
      DeduceEngine.matchingWords({ table, guesses: gs, polyMap: poly });
      samples.push(performance.now() - t0);
    }
    console.log(
      `[DeducePerf] matchingWords guesses=2 median=${median(samples).toFixed(2)}ms max=${Math.max(...samples).toFixed(2)}ms`,
    );

    // 默认读音下 0 条 → 触发保底展开，要完整扫描两遍：第 1 位声调固定为词库里不存在的 7，
    // 所有行都要走到读音检查才被淘汰（不被「字」约束提前剪掉），是扫描最慢的一类。
    const f = (): ReturnType<typeof deduceMark> => deduceMark("absent", "absent", "absent", "absent");
    const g = deduceGuessFromSlots([
      ["咖", "ka5", f()],
      ["咖", "ka5", f()],
      ["咖", "ka5", f()],
      ["咖", "ka5", f()],
    ]);
    g.chars[0].tone = 7;
    g.marks[0] = deduceMark("absent", "absent", "absent", "hit");
    const fb: number[] = [];
    let total = -1;
    for (let i = 0; i < 10; i++) {
      const t0 = performance.now();
      total = DeduceEngine.filter({ table, guesses: [g], polyMap: poly })?.total ?? -1;
      fb.push(performance.now() - t0);
    }
    console.log(`[DeducePerf] fallback-two-pass total=${total} median=${median(fb).toFixed(2)}ms max=${Math.max(...fb).toFixed(2)}ms`);
    expect(total).toBe(0);
    expect(median(fb)).toBeLessThan(200);
  });

  it("分块版本：每个时间片的同步执行时长（不卡界面）", async () => {
    const { table, poly } = realLexicon();
    const sets = scenarios(10);
    // 把最坏的一类（保底展开）也放进去
    const f = (): ReturnType<typeof deduceMark> => deduceMark("absent", "absent", "absent", "absent");
    const worst = deduceGuessFromSlots([
      ["咖", "ka5", f()],
      ["咖", "ka5", f()],
      ["咖", "ka5", f()],
      ["咖", "ka5", f()],
    ]);
    worst.chars[0].tone = 7;
    worst.marks[0] = deduceMark("absent", "absent", "absent", "hit");
    const jobs: DeduceGuess[][] = [[worst], ...sets.get(2)!, ...sets.get(4)!];

    // 用 setTimeout(0) 的「心跳」量出事件循环被占住的最长一段（即界面可能卡住的时长）
    let maxStall = 0;
    let last = performance.now();
    let running = true;
    const beat = (): void => {
      if (!running) return;
      const now = performance.now();
      maxStall = Math.max(maxStall, now - last);
      last = now;
      setTimeout(beat, 0);
    };
    setTimeout(beat, 0);
    const t0 = performance.now();
    for (const gs of jobs) {
      await DeduceEngine.filterAsync({ table, guesses: gs, polyMap: poly, includePolyphones: true });
      // 真实使用里两次筛选之间隔着去抖等待；这里让出事件循环，避免把「连续跑 N 次」误当成一次卡顿
      await new Promise((r) => setTimeout(r, 3));
    }
    const wall = performance.now() - t0;
    running = false;
    console.log(
      `[DeducePerf] 分块筛选 ${jobs.length} 次：墙钟 ${wall.toFixed(0)}ms，事件循环被占住的最长一段 ${maxStall.toFixed(1)}ms（含 3ms 的间隔）`,
    );
    expect(maxStall, "目标：远低于一帧之外的明显卡顿；实测约 12ms，这里留足余量避免机器繁忙时误报").toBeLessThan(100);
  });

  it("默认全选合并加载（含读文件）", async () => {
    const io = new FsDataIO();
    try {
      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const { snapshot } = await new LexiconStore({ io }).load();
        samples.push(performance.now() - t0);
        expect(snapshot.count).toBe(66289);
      }
      console.log(`[LoadPerf] 默认全选 9 个源合并 66289 条：${samples.map((x) => x.toFixed(0) + "ms").join(" / ")}`);
      expect(Math.min(...samples)).toBeLessThan(1500);
    } finally {
      io.dispose();
    }
  });
});
