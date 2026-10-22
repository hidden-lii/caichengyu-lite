// 快捷键相关的小工具：macOS（含浏览器里预览）用 ⌘，Windows / Linux 用 Ctrl。
//
// 界面上所有「按键提示」都从这里取文案，不要在模板里直接写 ⌘ ⌥ ⇧ 这些 Mac 符号：
// Windows / Linux 的用户不认识它们，要写成 Ctrl / Alt / Shift。
// 平台来自 <html data-platform>（main.ts 在挂载前写好），所以这些函数要在运行时调用，不能在模块顶层求值。

/** macOS 与浏览器预览（`data-platform="web"`，按 macOS 的样子画）都算 ⌘ 系 */
export function isMacLike(): boolean {
  const p = document.documentElement.dataset.platform;
  return p !== "windows" && p !== "linux";
}

/** 快捷键的修饰键是否按下（⌘ 或 Ctrl） */
export function hasCommandModifier(e: KeyboardEvent): boolean {
  return isMacLike() ? e.metaKey : e.ctrlKey;
}

/** 「确认本条并筛选」的快捷键提示 */
export function commitShortcutLabel(): string {
  return isMacLike() ? "⌘↩" : "Ctrl+Enter";
}

/** Alt / Option 键的写法：macOS 画 ⌥，Windows / Linux 写 Alt */
function altKeyLabel(): string {
  return isMacLike() ? "⌥" : "Alt";
}

/** Shift 键的写法：macOS 画 ⇧，Windows / Linux 写 Shift */
function shiftKeyLabel(): string {
  return isMacLike() ? "⇧" : "Shift";
}

/** 手势图例里「偏」的操作提示 */
export function presentGestureHint(): string {
  return `右键 / ${altKeyLabel()} 点击`;
}

/** 手势图例里「清除」的操作提示 */
export function clearGestureHint(): string {
  return `${shiftKeyLabel()} 点击`;
}

/** 标记块的悬停说明（完整的鼠标手势） */
export function markChipHelp(): string {
  return `左键：对/无 · 右键：偏 · 左右同时：清除（触控板：${altKeyLabel()} 点击=偏，${shiftKeyLabel()} 点击=清除）`;
}

/** 是否有模态层（详细标记、确认框、设置）开着：开着时主界面的快捷键不生效 */
export function hasOpenModal(): boolean {
  return document.querySelector(".m-modal-root") !== null;
}
