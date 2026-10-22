// 数据 IO 抽象。词库存储（LexiconStore）只通过它读写用户数据、读随包资源；
// 默认实现包装 `src/platform/index.ts`，测试里换成基于 fs 的实现。
//
// `name` 都是相对用户数据目录的路径（如 "settings.json"、"cache/meta.json"）；
// `bundled` 的路径相对 public/（如 "lexicon/merged.idx"）。

import * as platform from "../../platform";

export interface DataIO {
  /** 读文本；不存在返回 null。 */
  readData(name: string): Promise<string | null>;
  writeData(name: string, contents: string): Promise<void>;
  /** 读二进制；不存在返回 null。 */
  readDataBytes(name: string): Promise<Uint8Array | null>;
  writeDataBytes(name: string, bytes: Uint8Array): Promise<void>;
  removeData(name: string): Promise<void>;
  /** 改名并覆盖目标；源文件不存在时静默忽略。 */
  renameData(from: string, to: string): Promise<void>;
  /** 读随包资源。 */
  bundled(path: string): Promise<ArrayBuffer>;
  bundledText(path: string): Promise<string>;
}

/** 默认实现：直接转发到平台适配层。 */
export function createPlatformDataIO(): DataIO {
  return {
    readData: platform.readData,
    writeData: platform.writeData,
    readDataBytes: platform.readDataBytes,
    writeDataBytes: platform.writeDataBytes,
    removeData: platform.removeData,
    renameData: platform.renameData,
    bundled: platform.bundled,
    bundledText: platform.bundledText,
  };
}
