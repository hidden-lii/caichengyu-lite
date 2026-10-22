// Material 3 动态取色的 OKLCH → sRGB 转换（移植自 MaterialColor.swift）。
//
// 与 design/material-mock/index.html 里的 `tone()` 同一套算法：用 OKLCH 近似 M3 的色调板（tonal palette），
// 选一个主题色相 + 色度，就能生成整套浅色 / 深色配色。
// 超出 sRGB 色域的颜色按 CSS Color 4 的做法：保持明度与色相不变，降低色度直到落进色域。

import { type RGBA, rgba } from "./color";

type Triple = readonly [number, number, number];

/** 线性 sRGB（可能越界） */
function linear(L: number, C: number, hDeg: number): [number, number, number] {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(c: Triple): boolean {
  const e = 0.000001;
  return c.every((v) => v >= -e && v <= 1 + e);
}

function clip(c: Triple): [number, number, number] {
  return [Math.min(Math.max(c[0], 0), 1), Math.min(Math.max(c[1], 0), 1), Math.min(Math.max(c[2], 0), 1)];
}

/** sRGB 传递函数（线性 → gamma），先夹到 0...1 */
function encode(v: number): number {
  const x = Math.min(Math.max(v, 0), 1);
  return x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** 线性 sRGB → OKLab */
function oklab(c: Triple): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * c[0] + 0.5363325363 * c[1] + 0.0514459929 * c[2]);
  const m = Math.cbrt(0.2119034982 * c[0] + 0.6806995451 * c[1] + 0.1073969566 * c[2]);
  const s = Math.cbrt(0.0883024619 * c[0] + 0.2817188376 * c[1] + 0.6299787005 * c[2]);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaEOK(x: Triple, y: Triple): number {
  const p = oklab(x);
  const q = oklab(y);
  return Math.hypot(Math.hypot(p[0] - q[0], p[1] - q[1]), p[2] - q[2]);
}

/**
 * OKLCH → gamma 编码的 sRGB 分量（0...1）。超出色域时按 CSS Color 4 的色域映射：
 * 保持明度与色相，二分降低色度，直到「裁剪后的颜色」与「降色度后的颜色」的 ΔE_OK 小于 JND（0.02）。
 * Chrome 的 `oklch()` 就是这样处理的，所以和样图里看到的颜色一致。
 */
export function oklchToSrgb(L: number, C: number, h: number): { r: number; g: number; b: number } {
  const origin = linear(L, Math.max(0, C), h);
  let result: [number, number, number] = origin;
  if (!inGamut(origin)) {
    const jnd = 0.02;
    const eps = 0.0001;
    let clipped = clip(origin);
    if (deltaEOK(clipped, origin) < jnd) {
      result = clipped;
    } else {
      let lo = 0;
      let hi = Math.max(0, C);
      let loInGamut = true;
      while (hi - lo > eps) {
        const chroma = (lo + hi) / 2;
        const cur = linear(L, chroma, h);
        if (loInGamut && inGamut(cur)) {
          lo = chroma;
          continue;
        }
        clipped = clip(cur);
        const e = deltaEOK(clipped, cur);
        if (e < jnd) {
          if (jnd - e < eps) break;
          loInGamut = false;
          lo = chroma;
        } else {
          hi = chroma;
        }
      }
      result = clipped;
    }
  }
  return { r: encode(result[0]), g: encode(result[1]), b: encode(result[2]) };
}

/** 与样图 `tone(h, c, t)` 一致：t 是 M3 的色调（0 黑 … 100 白）。 */
export function materialTone(hue: number, chroma: number, t: number): RGBA {
  if (t <= 0) return rgba(0, 0, 0, 1);
  if (t >= 100) return rgba(1, 1, 1, 1);
  const L = (t + 16) / 116;
  const f = Math.min(1, t / 30, (100 - t) / 35);
  const h = (((hue % 360) + 360) % 360);
  const c = oklchToSrgb(L, chroma * f, h);
  return rgba(c.r, c.g, c.b, 1);
}
