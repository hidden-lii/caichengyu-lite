// 让出事件循环，让界面有机会处理输入与重绘（分块扫描时用）。

export function yieldToEventLoop(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** 高精度毫秒时钟（没有 performance 时退回 Date）。 */
export function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
