// 平台适配层：界面与逻辑代码只通过这里读写用户数据、复制文本、取随包资源。
//
// - 在 Tauri 里：用户数据走 Rust 命令（见 src-tauri/src/lib.rs，落在应用数据目录）；复制走剪贴板插件。
// - 在普通浏览器里（`npm run dev` + 无头 Chrome 截图 / 调试）：文本落 localStorage，二进制只放内存，
//   复制用 navigator.clipboard。这样不需要打开 Tauri 窗口就能看界面、跑流程。
//
// 随包资源（词库 .idx、polyphones.json）放在 public/lexicon/，两种环境都用 fetch 读取。

import { invoke } from "@tauri-apps/api/core";

export const isTauri: boolean =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type PlatformName = "macos" | "windows" | "linux" | "web";

let cachedPlatform: PlatformName | null = null;

/** 当前平台。浏览器里一律 `web`（界面按 macOS 的样子画，红绿灯留白由调用方决定）。 */
export async function platform(): Promise<PlatformName> {
  if (cachedPlatform) return cachedPlatform;
  if (!isTauri) return (cachedPlatform = "web");
  const os = await invoke<string>("platform");
  cachedPlatform = os === "macos" || os === "windows" || os === "linux" ? os : "linux";
  return cachedPlatform;
}

// ---------------------------------------------------------------------------
// 用户数据（相对数据目录的路径，如 "settings.json"、"cache/meta.json"）

const LS_PREFIX = "caichengyu:";
const memoryBytes = new Map<string, Uint8Array>();

export async function readData(name: string): Promise<string | null> {
  if (isTauri) return await invoke<string | null>("read_data", { name });
  return localStorage.getItem(LS_PREFIX + name);
}

export async function writeData(name: string, contents: string): Promise<void> {
  if (isTauri) {
    await invoke("write_data", { name, contents });
    return;
  }
  localStorage.setItem(LS_PREFIX + name, contents);
}

export async function readDataBytes(name: string): Promise<Uint8Array | null> {
  if (isTauri) {
    try {
      const buf = await invoke<ArrayBuffer>("read_data_bytes", { name });
      return new Uint8Array(buf);
    } catch (e) {
      if (String(e) === "NOT_FOUND") return null;
      throw e;
    }
  }
  return memoryBytes.get(name) ?? null;
}

export async function writeDataBytes(name: string, bytes: Uint8Array): Promise<void> {
  if (isTauri) {
    await invoke("write_data_bytes", bytes, { headers: { "x-name": encodeURIComponent(name) } });
    return;
  }
  memoryBytes.set(name, bytes);
}

export async function removeData(name: string): Promise<void> {
  if (isTauri) {
    await invoke("remove_data", { name });
    return;
  }
  localStorage.removeItem(LS_PREFIX + name);
  memoryBytes.delete(name);
}

/** 改名并覆盖目标；源文件不存在时静默忽略。 */
export async function renameData(from: string, to: string): Promise<void> {
  if (isTauri) {
    await invoke("rename_data", { from, to }).catch((e) => {
      if (!/No such file|not found|找不到/i.test(String(e))) throw e;
    });
    return;
  }
  const text = localStorage.getItem(LS_PREFIX + from);
  if (text !== null) {
    localStorage.setItem(LS_PREFIX + to, text);
    localStorage.removeItem(LS_PREFIX + from);
  }
  const bytes = memoryBytes.get(from);
  if (bytes) {
    memoryBytes.set(to, bytes);
    memoryBytes.delete(from);
  }
}

export async function dataExists(name: string): Promise<boolean> {
  if (isTauri) return await invoke<boolean>("data_exists", { name });
  return localStorage.getItem(LS_PREFIX + name) !== null || memoryBytes.has(name);
}

/** 用户数据目录的路径（只用于提示 / 排查）；浏览器里返回说明文字。 */
export async function dataDirLabel(): Promise<string> {
  return isTauri ? await invoke<string>("data_dir") : "（浏览器调试模式：localStorage）";
}

// ---------------------------------------------------------------------------
// 随包资源

/** 读取 public/ 下的随包资源，例如 `bundled("lexicon/merged.idx")`。 */
export async function bundled(path: string): Promise<ArrayBuffer> {
  const url = `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`读取随包资源失败：${path}（HTTP ${res.status}）`);
  return await res.arrayBuffer();
}

export async function bundledText(path: string): Promise<string> {
  return new TextDecoder("utf-8").decode(await bundled(path));
}

// ---------------------------------------------------------------------------
// 剪贴板

/** 写入系统剪贴板；成功返回 true。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (isTauri) {
      const { writeText } = await import("@tauri-apps/plugin-clipboard-manager");
      await writeText(text);
      return true;
    }
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 窗口

/** 让原生窗口的明暗与背景色跟随主题（只在 Tauri 里生效；失败不影响使用）。 */
export async function syncWindow(options: { dark: boolean; background: string }): Promise<void> {
  if (!isTauri) return;
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const win = getCurrentWindow();
    await win.setTheme(options.dark ? "dark" : "light");
    await win.setBackgroundColor(options.background);
  } catch {
    /* 背景色 / 主题只是锦上添花 */
  }
}
