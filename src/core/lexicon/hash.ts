// 64 位 FNV-1a / 校验和，用 32 位高低半部实现（不用 BigInt，热路径快一个数量级）。
//
// FNV 素数 = 2^40 + 0x1b3，所以 h * prime (mod 2^64) = (h << 40) + h * 0x1b3：
//   lo' = (lo * 0x1b3) mod 2^32
//   hi' = (hi * 0x1b3 + floor(lo * 0x1b3 / 2^32) + ((lo << 8) mod 2^32)) mod 2^32
// lo、hi 都 < 2^32，乘 435 后 < 2^41，在双精度整数范围内精确。

export const FNV_OFFSET_HI = 0xcbf29ce4;
export const FNV_OFFSET_LO = 0x84222325;

/** 最近一次 `fnvScalars` / `hashWords` 的结果（高 / 低 32 位）。读完马上用，下次调用会覆盖。 */
export const hashOut = { hi: 0, lo: 0 };

/** FNV-1a 64，对词的 Unicode 标量序列逐字节（每个标量按小端 4 字节）计算；结果在 `hashOut`。 */
export function fnvScalars(src: ArrayLike<number>, start: number, end: number): void {
  let hi = FNV_OFFSET_HI;
  let lo = FNV_OFFSET_LO;
  for (let k = start; k < end; k++) {
    let x = src[k];
    for (let b = 0; b < 4; b++) {
      lo = (lo ^ (x & 0xff)) >>> 0;
      x >>>= 8;
      const p = lo * 435;
      const carry = Math.floor(p / 4294967296);
      hi = (hi * 435 + carry + ((lo << 8) >>> 0)) >>> 0;
      lo = p >>> 0;
    }
  }
  hashOut.hi = hi;
  hashOut.lo = lo;
}

/** FNV-1a 64，对字节序列逐字节计算（每个字节当作一个标量，同 Swift `wordHash(data.map { UInt32($0) })`）。 */
export function fnvBytesAsScalars(bytes: Uint8Array): void {
  let hi = FNV_OFFSET_HI;
  let lo = FNV_OFFSET_LO;
  for (let k = 0; k < bytes.length; k++) {
    const x = bytes[k];
    // 标量的 4 个小端字节：x, 0, 0, 0
    for (let b = 0; b < 4; b++) {
      lo = (lo ^ (b === 0 ? x : 0)) >>> 0;
      const p = lo * 435;
      const carry = Math.floor(p / 4294967296);
      hi = (hi * 435 + carry + ((lo << 8) >>> 0)) >>> 0;
      lo = p >>> 0;
    }
  }
  hashOut.hi = hi;
  hashOut.lo = lo;
}

/**
 * 逐 8 字节的轻量校验（用于发现截断 / 损坏，不是密码学哈希）。
 * `words` 是按小端排列的 u32 对（lo, hi, lo, hi, …），`pairCount` 为 64 位字的个数；结果在 `hashOut`。
 */
export function hashWords(words: Uint32Array, startWord: number, pairCount: number): void {
  let hi = FNV_OFFSET_HI;
  let lo = FNV_OFFSET_LO;
  let idx = startWord;
  for (let i = 0; i < pairCount; i++) {
    lo = (lo ^ words[idx]) >>> 0;
    hi = (hi ^ words[idx + 1]) >>> 0;
    idx += 2;
    const p = lo * 435;
    const carry = Math.floor(p / 4294967296);
    hi = (hi * 435 + carry + ((lo << 8) >>> 0)) >>> 0;
    lo = p >>> 0;
    // h ^= h >> 29
    const sLo = ((hi << 3) | (lo >>> 29)) >>> 0;
    const sHi = hi >>> 29;
    lo = (lo ^ sLo) >>> 0;
    hi = (hi ^ sHi) >>> 0;
  }
  hashOut.hi = hi;
  hashOut.lo = lo;
}

/** 64 位值的十六进制（不补零，同 Swift `String(h, radix: 16)`）。 */
export function hex64(hi: number, lo: number): string {
  if (hi === 0) return lo.toString(16);
  return hi.toString(16) + lo.toString(16).padStart(8, "0");
}

/** 64 位值的十六进制（补零到 16 位）。 */
export function hex64Padded(hi: number, lo: number): string {
  return hi.toString(16).padStart(8, "0") + lo.toString(16).padStart(8, "0");
}
