// 测试公共设施：基于 fs 的 DataIO（读 public/，写临时目录）、真实词库加载等。

import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync, renameSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { DataIO } from "../../../src/core/lexicon/dataIO";

export const repoRoot = resolve(__dirname, "../../..");
export const publicDir = join(repoRoot, "public");
export const fixturesDir = join(repoRoot, "tests/fixtures");

/** 只读 public/ 的随包资源 + 写入临时目录的用户数据。 */
export class FsDataIO implements DataIO {
  readonly root: string;
  readonly bundleRoot: string;
  /** 记录调用，供断言「有没有碰过某文件」 */
  readonly bundledReads: string[] = [];
  /** 让 bundled() 对指定路径失败（模拟文件缺失） */
  readonly bundledMissing = new Set<string>();
  /** 覆盖某个随包资源的内容 */
  readonly bundledOverride = new Map<string, Uint8Array>();

  constructor(root?: string, bundleRoot: string = publicDir) {
    this.root = root ?? mkdtempSync(join(tmpdir(), "cc-lite-"));
    this.bundleRoot = bundleRoot;
  }

  path(name: string): string {
    return join(this.root, name);
  }

  dispose(): void {
    rmSync(this.root, { recursive: true, force: true });
  }

  async readData(name: string): Promise<string | null> {
    const p = this.path(name);
    return existsSync(p) ? readFileSync(p, "utf-8") : null;
  }

  async writeData(name: string, contents: string): Promise<void> {
    const p = this.path(name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, contents, "utf-8");
  }

  async readDataBytes(name: string): Promise<Uint8Array | null> {
    const p = this.path(name);
    if (!existsSync(p)) return null;
    // 拷贝成独立的 ArrayBuffer，模拟 Tauri 返回的数据
    const buf = readFileSync(p);
    const out = new Uint8Array(buf.byteLength);
    out.set(buf);
    return out;
  }

  async writeDataBytes(name: string, bytes: Uint8Array): Promise<void> {
    const p = this.path(name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, bytes);
  }

  async removeData(name: string): Promise<void> {
    rmSync(this.path(name), { force: true });
  }

  async renameData(from: string, to: string): Promise<void> {
    const f = this.path(from);
    if (!existsSync(f)) return;
    const t = this.path(to);
    mkdirSync(dirname(t), { recursive: true });
    renameSync(f, t);
  }

  async bundled(path: string): Promise<ArrayBuffer> {
    this.bundledReads.push(path);
    if (this.bundledMissing.has(path)) throw new Error(`读取随包资源失败：${path}（HTTP 404）`);
    const override = this.bundledOverride.get(path);
    if (override) {
      const copy = new Uint8Array(override.byteLength);
      copy.set(override);
      return copy.buffer;
    }
    const buf = readFileSync(join(this.bundleRoot, path));
    const out = new Uint8Array(buf.byteLength);
    out.set(buf);
    return out.buffer;
  }

  async bundledText(path: string): Promise<string> {
    return new TextDecoder("utf-8").decode(await this.bundled(path));
  }

  /** 用户数据目录下的文件名（相对），用于缓存文件断言。 */
  list(dir = ""): string[] {
    const p = this.path(dir);
    return existsSync(p) ? readdirSync(p).sort() : [];
  }
}
