// 布局报告：导出页面里所有带 class 的元素的位置尺寸 + 字体可用性，用来在不同渲染引擎
// （无头 Chrome 与真实 Tauri 窗口里的 WKWebView）之间做数值对照——抓屏没有权限时的替代办法。
// 只在调试构建里由 main.ts 引入，不进发布包。

export interface LayoutReport {
  userAgent: string;
  dpr: number;
  inner: [number, number];
  fonts: Record<string, boolean>;
  errors: string[];
  /** [标签.首个class, x, y, w, h]，按 DOM 顺序 */
  rects: [string, number, number, number, number][];
}

const FONT_PROBES = [
  "Songti SC",
  "STSong",
  "Kaiti SC",
  "STKaiti",
  "Heiti SC",
  "PingFang SC",
  "Hiragino Sans GB",
  "Menlo",
  "SF Mono",
  "Helvetica Neue",
];

const round = (n: number): number => Math.round(n * 10) / 10;

export function collectReport(errors: string[] = []): LayoutReport {
  const rects: LayoutReport["rects"] = [];
  for (const el of document.querySelectorAll<HTMLElement>("#app *")) {
    const cls = typeof el.className === "string" ? el.className.trim() : "";
    if (!cls) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    rects.push([`${el.tagName.toLowerCase()}.${cls.split(/\s+/)[0]}`, round(r.x), round(r.y), round(r.width), round(r.height)]);
  }
  const fonts: Record<string, boolean> = {};
  for (const f of FONT_PROBES) fonts[f] = document.fonts.check(`16px "${f}"`);
  return {
    userAgent: navigator.userAgent,
    dpr: window.devicePixelRatio,
    inner: [window.innerWidth, window.innerHeight],
    fonts,
    errors,
    rects,
  };
}
