// 对照基准截图（mac 版真实渲染）里的实际像素：外观页 15 张主题卡的 6 格色板必须和我们算出的主题色一致。
// 截图是 Display P3 配置的 PNG，取色前先换算回 sRGB；允许 ±2（P3 编码 8 位量化 + 来回换算的误差）。
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { builtinPalettes, toCss } from "../../src/theme";
import { maxDiff, readPng, sampleSrgb } from "./helpers/png";

const file = resolve(__dirname, "../reference/appearance-builtin.png");

describe.skipIf(!existsSync(file))("基准截图 appearance-builtin.png 的主题色板", () => {
  // 2x 截图：卡片左缘 x = 60 / 467 / 873，色板行 y = 326 + 214 * 行；每格宽 ≈ 57.8
  const xs = [60, 467, 873];
  const y0 = 326;
  const dy = 214;
  it("15 套内置主题 × 6 格（背景 / 卡片底 / 强调 / 对 / 偏 / 无）", () => {
    const img = readPng(file);
    builtinPalettes.forEach((p, i) => {
      const x0 = xs[i % 3]!;
      const y = y0 + dy * Math.floor(i / 3);
      const expected = [p.bgMid, p.surface, p.accent, p.hit, p.present, p.absent].map((c) => toCss(c).toUpperCase());
      expected.forEach((want, k) => {
        const got = sampleSrgb(img, x0 + Math.floor(k * 57.8 + 29), y);
        expect(maxDiff(got, want), `${p.id} 第 ${k + 1} 格 期望 ${want} 实际 ${got}`).toBeLessThanOrEqual(2);
      });
    });
  });
});
