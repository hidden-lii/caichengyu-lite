// 主题的运行时：全局唯一的 ThemeStore、把主题写到 <html>、`?style=<id>` 临时覆盖、窗口同步，以及给组件用的 `useTheme()`。

import { computed, reactive, watch } from "vue";
import * as platform from "../platform";
import { toCss } from "./color";
import { applyThemeToElement, diagonalGradient } from "./cssVars";
import {
  type FontChoice,
  type FontSettings,
} from "./fonts";
import { type MaterialSeed, type Palette } from "./palette";
import { ThemeStore } from "./store";

/** 全局唯一的外观存储（= Swift 的 `ThemeStore.shared`） */
export const themeStore = new ThemeStore();

let installPromise: Promise<void> | null = null;

function viewport(): { width: number; height: number } | undefined {
  return typeof window === "undefined" ? undefined : { width: window.innerWidth, height: window.innerHeight };
}

/** 读取 URL 参数 `?style=<id>`（调试用的临时主题覆盖：m-<色>-<light|dark>、旧主题 id 或自定义主题 id） */
export function styleOverrideFromUrl(search: string = typeof location === "undefined" ? "" : location.search): string | null {
  const id = new URLSearchParams(search).get("style");
  return id && id.length > 0 ? id : null;
}

/**
 * 安装主题：读取已保存的外观、把当前主题 / 字体写到 `<html>`（CSS 变量、data-scheme、color-scheme），
 * 之后主题或字体一变就同步更新，并让原生窗口的明暗与背景色跟随。重复调用只做一次。
 *
 * 在 main.ts 里 `await installTheme()` 之后再 mount，第一帧就是正确的主题，不会闪一下默认外观。
 */
export function installTheme(): Promise<void> {
  if (installPromise) return installPromise;
  installPromise = (async () => {
    const store = themeStore;
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      let lastWindow = "";
      const apply = (): void => {
        const p = store.palette.value;
        applyThemeToElement(root, p, store.fonts.value, viewport());
        const bg = toCss(p.bgMid).slice(0, 7);
        const key = `${p.scheme}|${bg}`;
        if (key !== lastWindow) {
          lastWindow = key;
          void platform.syncWindow({ dark: p.scheme === "dark", background: bg });
        }
      };
      apply();
      // flush: "sync"：状态一变 CSS 变量立即更新，同一帧里不会出现新旧混搭
      watch([store.palette, store.fonts], apply, { flush: "sync" });

      // 渐变角度跟着窗口宽高走（SwiftUI 的对角渐变）；平涂主题不需要
      let raf = 0;
      window.addEventListener("resize", () => {
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const p = store.palette.value;
          if (p.bgTop === p.bgMid && p.bgMid === p.bgBottom) return;
          const vp = viewport();
          if (vp) root.style.setProperty("--cc-bg-gradient", diagonalGradient(p, vp.width, vp.height));
        });
      });

      // 页面隐藏 / 关闭时把还没写的改动写出去
      const flush = (): void => void store.flush();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") flush();
      });
      window.addEventListener("pagehide", flush);
    }

    await store.load();
    const override = styleOverrideFromUrl();
    if (override) store.select(override, false);
  })();
  return installPromise;
}

/** `useTheme()` 的返回值：响应式状态（模板里直接读 `theme.palette.accent` 之类）+ 方法。全局共享同一个实例。 */
function createTheme() {
  const s = themeStore;
  return reactive({
    // —— 状态 ——
    /** 当前生效的主题（Palette，颜色是 RGBA 对象；要 CSS 颜色用 `var(--cc-*)` 更省事） */
    palette: s.palette,
    /** 当前字体设置 */
    fonts: s.fonts,
    /** 已持久化选中的主题 id */
    selectedID: s.selectedID,
    /** 用户的自定义主题 */
    customThemes: s.customThemes,
    /** 全部主题：内置 15 套 + 自定义 */
    allThemes: s.allThemes,
    /** 选中的是不是自定义主题 */
    selectedIsCustom: s.selectedIsCustom,
    /** 选中的若是 Material 内置主题：{ seed, dark }，否则 null */
    currentMaterial: s.currentMaterial,
    /** 读 / 写外观文件遇到的问题（设置页展示），没有为 null */
    loadNote: s.loadNote,
    /** 当前是不是深色 */
    isDark: computed(() => s.palette.value.scheme === "dark"),

    // —— 主题 ——
    /** 切换主题；`persist: false` 只在本次运行生效 */
    select: (id: string, persist = true): void => s.select(id, persist),
    /** Material 主题里换主题色 / 明暗 */
    selectMaterial: (options: { seed?: MaterialSeed; dark?: boolean }): void => s.selectMaterial(options),
    /** 以当前主题为底复制一套自定义主题并选中 */
    duplicateCurrent: (): Palette => s.duplicateCurrent(),
    /** 修改当前选中的自定义主题（内置主题时无效） */
    updateCurrentCustom: (mutate: (p: Palette) => void): void => s.updateCurrentCustom(mutate),
    resetCurrentCustomToBase: (): void => s.resetCurrentCustomToBase(),
    deleteCustom: (id: string): void => s.deleteCustom(id),

    // —— 字体 ——
    updateFonts: (mutate: (f: FontSettings) => void): void => s.updateFonts(mutate),
    /** 界面字体 */
    setUiFont: (c: FontChoice): void => s.updateFonts((f) => void (f.ui = c)),
    /** 成语字头字体（宋体 / 楷体 / 黑体=system） */
    setWordFont: (c: FontChoice): void => s.updateFonts((f) => void (f.word = c)),
    /** 整体字号缩放（0.9 … 1.25） */
    setFontScale: (scale: number): void => s.updateFonts((f) => void (f.scale = scale)),
    resetFonts: (): void => s.resetFonts(),
  });
}

let theme: ReturnType<typeof createTheme> | null = null;

/** 组件里取主题：`const theme = useTheme()`。 */
export function useTheme(): ReturnType<typeof createTheme> {
  return (theme ??= createTheme());
}
