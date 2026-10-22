// 测试用的最小 PNG 解码器（8 位、非隔行、RGB / RGBA）与 Display P3 → sRGB 换算。
// 基准截图（tests/reference/*.png）由 macOS 渲染，带 Display P3 的 ICC 配置；取色要先换算回 sRGB 才能和主题里的十六进制比。
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

export interface Png {
  width: number;
  height: number;
  channels: number;
  /** 每行一个 Uint8Array */
  rows: Uint8Array[];
}

export function readPng(path: string): Png {
  const d = readFileSync(path);
  let pos = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat: Buffer[] = [];
  while (pos < d.length) {
    const len = d.readUInt32BE(pos);
    const type = d.toString("ascii", pos + 4, pos + 8);
    const data = d.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9]!;
      if (data[8] !== 8 || data[12] !== 0) throw new Error("只支持 8 位非隔行 PNG");
    } else if (type === "IDAT") idat.push(data);
  }
  const channels = colorType === 2 ? 3 : colorType === 6 ? 4 : colorType === 0 ? 1 : 2;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows: Uint8Array[] = [];
  let prev = new Uint8Array(stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const f = raw[p++]!;
    const line = Uint8Array.from(raw.subarray(p, p + stride));
    p += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels]! : 0;
      const b = prev[i]!;
      const c = i >= channels ? prev[i - channels]! : 0;
      let add = 0;
      if (f === 1) add = a;
      else if (f === 2) add = b;
      else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = (line[i]! + add) & 255;
    }
    rows.push(line);
    prev = line;
  }
  return { width, height, channels, rows };
}

const dec = (v: number): number => {
  const x = v / 255;
  return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
};
const enc = (v: number): number => {
  const x = Math.max(0, Math.min(1, v));
  return x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
};
const P3_TO_SRGB = [
  [1.2249401, -0.2249404, 0],
  [-0.0420569, 1.0420571, 0],
  [-0.0196376, -0.0786361, 1.0982735],
] as const;

/** 取 (x, y) 的像素，Display P3 → sRGB，返回 "#RRGGBB" */
export function sampleSrgb(img: Png, x: number, y: number): string {
  const row = img.rows[y]!;
  const o = x * img.channels;
  const lin = [dec(row[o]!), dec(row[o + 1]!), dec(row[o + 2]!)];
  const out = P3_TO_SRGB.map((m) => Math.round(255 * enc(m[0] * lin[0]! + m[1] * lin[1]! + m[2] * lin[2]!)));
  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** 两个 "#RRGGBB" 的最大分量差 */
export function maxDiff(a: string, b: string): number {
  let m = 0;
  for (let i = 1; i < 7; i += 2) m = Math.max(m, Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)));
  return m;
}
