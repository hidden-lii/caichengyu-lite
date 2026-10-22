import { createApp, nextTick } from "vue";
import "./styles";
import App from "./App.vue";
import { appModelKey } from "./app/context";
import { createAppModel } from "./app/model";
import { invoke } from "@tauri-apps/api/core";
import { isTauri, platform, type PlatformName } from "./platform";
import { installTheme, themeStore } from "./theme";

declare global {
  interface Window {
    /** 启动守卫（public/boot-guard.js）：记录启动阶段，挂载成功后撤掉兜底，失败时把原因显示在窗口里 */
    __CC_BOOT__?: {
      stage(name: string): void;
      fail(message: string): void;
      mounted(): void;
    };
    /** 界面与场景都布置好、可以截图 / 开始操作时置 true（给 scripts/shot.mjs 等待用） */
    __CC_READY__?: boolean;
    /** 仅开发 / 调试：应用模型，便于在控制台或截图脚本里直接驱动 */
    __CC_MODEL__?: unknown;
    /** 仅调试：导出布局报告（见 src/dev/report.ts） */
    __CC_REPORT__?: () => unknown;
  }
}

// 调试构建（`npm run dev` 或 `tauri build --debug`）才允许布置截图场景；发布构建里这些分支会被整体剔除
const debugBuild = import.meta.env.DEV || import.meta.env.TAURI_ENV_DEBUG === "true";

/** 调试构建的真实窗口里，把诊断行经 Rust 打到标准错误（发布构建什么也不做） */
function dlog(message: string): void {
  if (debugBuild && isTauri) void invoke("debug_log", { message }).catch(() => undefined);
}

/** 记一个启动阶段：给启动守卫（出错时显示「走到了哪一步」）和调试构建的标准错误各记一份 */
function mark(stage: string): void {
  window.__CC_BOOT__?.stage(stage);
  dlog(`CC_STAGE ${stage}`);
}

function errorText(e: unknown): string {
  return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

/** 取不到平台信息（原生命令没响应）时，按浏览器内核猜一个，让界面至少能按对的平台画出来 */
function guessPlatform(): PlatformName {
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "macos";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "web";
}

const runtimeErrors: string[] = [];
window.addEventListener("error", (e) => {
  runtimeErrors.push(`${e.message} @${e.filename}:${e.lineno}`);
  dlog(`CC_ERROR ${e.message} @${e.filename}:${e.lineno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  runtimeErrors.push(`unhandledrejection: ${String(e.reason)}`);
  dlog(`CC_ERROR unhandledrejection: ${String(e.reason)}`);
});

async function bootstrap(): Promise<void> {
  mark("script start");
  // 平台写到 <html data-platform>：CSS 里据此区分红绿灯留白（macOS / web）与系统标题栏（Windows / Linux）。
  // 原生命令出错不挡着界面挂载：记下错误、按内核猜平台，界面照常起来（之后读写数据的错误会在界面里显示）。
  try {
    document.documentElement.dataset.platform = await platform();
    mark("platform ok");
  } catch (e) {
    runtimeErrors.push(`platform failed: ${errorText(e)}`);
    document.documentElement.dataset.platform = guessPlatform();
    mark("platform failed");
  }
  const tauriDebug = debugBuild && isTauri
    ? await invoke<{ scene: string | null; style: string | null }>("debug_env")
    : { scene: null, style: null };

  // 先装主题再挂载：第一帧就是正确的主题，不会闪一下默认外观。读取已保存外观失败时用默认外观，不挡着挂载
  mark("debug_env ok");
  try {
    await installTheme();
    mark("theme ok");
  } catch (e) {
    runtimeErrors.push(`theme failed: ${errorText(e)}`);
    mark("theme failed");
  }
  if (tauriDebug.style) themeStore.select(tauriDebug.style, false);

  const model = createAppModel();
  const app = createApp(App);
  app.provide(appModelKey, model);
  // Vue 生产环境下，首次渲染里组件抛的错只会打到控制台、挂载照常「成功」，结果就是白屏。
  // 挂载过程中的渲染错误交给启动守卫显示；挂载完成后的错误只记录，不弹面板。
  let booting = true;
  let renderFailed = false;
  app.config.errorHandler = (err, _instance, info) => {
    runtimeErrors.push(`vue error (${info}): ${errorText(err)}`);
    dlog(`CC_ERROR vue (${info}): ${errorText(err)}`);
    console.error(err);
    if (booting) {
      renderFailed = true;
      window.__CC_BOOT__?.fail(`界面渲染出错（${info}）：${errorText(err)}`);
    }
  };
  app.mount("#app");
  booting = false;
  if (!renderFailed) window.__CC_BOOT__?.mounted();
  mark("mounted");
  await model.start();
  dlog(`CC_STAGE model ${model.state.phase} ${model.state.phaseMessage}`);

  // 开发调试：`?scene=main|empty|menu|detail|settings-lexicon|settings-appearance`（浏览器）或环境变量
  // CAICHENGYU_SCENE（Tauri 调试构建）布置好固定场景，用于截图对比
  if (debugBuild) {
    window.__CC_MODEL__ = model;
    const { applyScene, sceneFromUrl, sceneFromName } = await import("./dev/scenes");
    const scene = sceneFromName(tauriDebug.scene) ?? sceneFromUrl();
    if (scene) await applyScene(scene, model);
    dlog(`CC_STAGE scene ${scene ?? "none"} applied`);
  }

  await nextTick();
  // 再等两帧，让过渡 / 字体 / 布局落定。窗口被遮挡 / 在后台时浏览器可能暂停 rAF，所以加超时兜底
  await new Promise<void>((r) => {
    const timer = window.setTimeout(r, 600);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.clearTimeout(timer);
        r();
      }),
    );
  });
  window.__CC_READY__ = true;

  if (debugBuild) {
    const { collectReport } = await import("./dev/report");
    window.__CC_REPORT__ = () => collectReport(runtimeErrors);
    // 真实 Tauri 窗口：把报告经 Rust 打到标准错误，scripts/app-report.mjs 收取
    if (isTauri) await invoke("debug_log", { message: "CC_REPORT " + JSON.stringify(collectReport(runtimeErrors)) });
  }
}

bootstrap().catch((e) => {
  dlog(`CC_ERROR bootstrap failed: ${String(e)}`);
  // 启动失败不要留白屏：让启动守卫把原因显示出来
  window.__CC_BOOT__?.fail(`启动失败：${errorText(e)}`);
});
