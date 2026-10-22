// 应用级状态：词库加载阶段、当前词库快照、「猜成语」会话。对应 mac 版 `App/AppModel.swift` 与
// `App/SettingsContainer.swift` 里的 `SettingsTab`。
//
// `createAppModel(deps?)` 返回一个普通对象：
// · `state` 是 Vue `reactive()` 对象（视图只读它、或在模板里 `v-model` 简单字段）；
// · `statusText` / `statusChipText` / `statusIsHealthy` 是 getter，读的都是 `state`，所以在模板 / computed 里随状态变化；
// · `start()` / `adopt()` / `openSettings()` 等是方法。

import { markRaw, reactive } from "vue";
import { createPlatformDataIO, type DataIO } from "../core/lexicon/dataIO";
import { LexiconStore } from "../core/lexicon/store";
import {
  outcomeChanged,
  type LexiconSnapshot,
  type LoadReport,
} from "../core/lexicon/types";
import { DeduceSession, type DeduceSessionOptions } from "../core/session/session";
import type { PersistOutcome, PersistRequest } from "../core/session/types";

/** 设置页签：词库、外观。 */
export type SettingsTab = "lexicon" | "appearance";

/** 词库加载阶段。 */
export type AppPhase = "loading" | "ready" | "failed";

export interface AppModelState {
  phase: AppPhase;
  /** `loading`：当前进度文案（如「正在合并词库…」）；`failed`：错误文案；`ready`：空串 */
  phaseMessage: string;
  /** 当前词库快照；加载失败且还没恢复时为 null（已 markRaw，不会被深度代理） */
  snapshot: LexiconSnapshot | null;
  /** 最近一次加载 / 变更的执行情况 */
  lastReport: LoadReport | null;
  /** 「猜成语」会话；词库就绪之后才有（已 markRaw） */
  session: DeduceSession | null;
  /** 外观菜单（应用栏右上角的调色盘）是否展开 */
  themeMenuOpen: boolean;
  /** 设置弹层是否打开，以及停在哪一页 */
  settingsOpen: boolean;
  settingsTab: SettingsTab;
}

export interface AppModelDeps {
  /** 数据 IO，缺省为平台适配层 */
  io?: DataIO;
  /** 直接注入词库存储（测试用）；缺省按 `io` 新建 */
  store?: LexiconStore;
  /** 会话的可选参数（去抖时间、时钟、筛选执行体），测试用 */
  sessionOptions?: Partial<Omit<DeduceSessionOptions, "lexicon" | "persist">>;
}

export interface AppModel {
  readonly state: AppModelState;
  /** 词库存储：设置页的「应用来源 / 新增 / 改读音 / 删除」直接调它，成功后把 `result.snapshot` 交给 `adopt()`。 */
  readonly store: LexiconStore;
  /** 顶部状态文案（对应桌面 statusText），如「词库已就绪（66289 条 · 跳过 1640 条 · 多音字 777）」 */
  readonly statusText: string;
  /** 应用栏里状态标签的短文案（完整说明见 `statusText`，放在悬停提示里） */
  readonly statusChipText: string;
  /** 词库已就绪且非空 */
  readonly statusIsHealthy: boolean;
  /** 开始加载词库（只会执行一次）；返回的 Promise 在加载结束（成功或失败）后 resolve，调用方可以不 await。 */
  start(): Promise<void>;
  /**
   * 换上新的词库快照（写库 / 换来源之后）。已记录猜测里的读音不受影响，候选会重新筛选。
   * 启动时加载失败、后来在设置里恢复成功的情况，也走这里：补建会话并进入就绪态。
   */
  adopt(snapshot: LexiconSnapshot): void;
  /**
   * 打开设置弹层（应用栏齿轮、词库状态标签、外观菜单里的「更多外观设置」、⌘,）。
   * 别的模态层（详细标记、各种确认框）正开着时不弹：两层同时挂在一个窗口上会互相打架，
   * 而且那时主窗口本来就点不到入口，只有 ⌘, 能走到这里。
   */
  openSettings(tab?: SettingsTab): void;
  closeSettings(): void;
  /** 会话要求把读音写进词库：新增或更新读音。成功后换上新快照。 */
  persist(request: PersistRequest): Promise<PersistOutcome>;
  /** 释放会话（页面销毁时调用）。 */
  dispose(): void;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createAppModel(deps: AppModelDeps = {}): AppModel {
  const store = deps.store ?? new LexiconStore({ io: deps.io ?? createPlatformDataIO() });
  const state = reactive({
    phase: "loading",
    phaseMessage: "正在载入词库…",
    snapshot: null,
    lastReport: null,
    session: null,
    themeMenuOpen: false,
    settingsOpen: false,
    settingsTab: "lexicon",
  }) as unknown as AppModelState;
  let startPromise: Promise<void> | null = null;

  function makeSession(snapshot: LexiconSnapshot): DeduceSession {
    return markRaw(
      new DeduceSession({
        ...deps.sessionOptions,
        lexicon: snapshot,
        persist: (request) => model.persist(request),
      }),
    );
  }

  /** 进度回调可能晚于加载完成才被调度，只在仍处于加载中时才生效。 */
  function setProgress(message: string): void {
    if (state.phase === "loading") state.phaseMessage = message;
  }

  const model: AppModel = {
    state,
    store,

    get statusText(): string {
      switch (state.phase) {
        case "loading":
          return "词库加载中…";
        case "failed":
          return `加载失败：${state.phaseMessage}`;
        case "ready": {
          const snap = state.snapshot;
          if (snap === null) return "词库加载中…";
          if (snap.count === 0) return "词库为空，请在设置中选择词库";
          let text = `词库已就绪（${snap.count} 条`;
          if (snap.skipped > 0) text += ` · 跳过 ${snap.skipped} 条`;
          if (snap.polyMap.size > 0) text += ` · 多音字 ${snap.polyMap.size}`;
          return text + "）";
        }
      }
    },

    get statusChipText(): string {
      switch (state.phase) {
        case "loading":
          return "词库加载中…";
        case "failed":
          return "词库加载失败";
        case "ready": {
          const snap = state.snapshot;
          if (snap === null || snap.count === 0) return "词库为空";
          return "词库 " + snap.count.toLocaleString("zh-CN");
        }
      }
    },

    get statusIsHealthy(): boolean {
      return state.phase === "ready" && state.snapshot !== null && state.snapshot.count > 0;
    },

    start(): Promise<void> {
      if (startPromise !== null) return startPromise;
      startPromise = (async () => {
        try {
          const { snapshot, report } = await store.load((message) => setProgress(message));
          state.snapshot = markRaw(snapshot);
          state.lastReport = report;
          state.session = makeSession(snapshot);
          state.phase = "ready";
          state.phaseMessage = "";
        } catch (e) {
          state.phase = "failed";
          state.phaseMessage = errorMessage(e);
        }
      })();
      return startPromise;
    },

    adopt(snapshot: LexiconSnapshot): void {
      state.snapshot = markRaw(snapshot);
      const session = state.session;
      if (session !== null) {
        session.lexicon = snapshot;
      } else {
        state.session = makeSession(snapshot);
        state.phase = "ready";
        state.phaseMessage = "";
      }
    },

    openSettings(tab?: SettingsTab): void {
      const session = state.session;
      if (
        session !== null &&
        (session.state.showDetailPanel ||
          session.state.restartRequest !== null ||
          session.state.clearConfirmOpen ||
          session.state.persistDialog !== null)
      ) {
        return;
      }
      if (tab !== undefined) state.settingsTab = tab;
      state.themeMenuOpen = false;
      state.settingsOpen = true;
    },

    closeSettings(): void {
      state.settingsOpen = false;
    },

    async persist(request: PersistRequest): Promise<PersistOutcome> {
      try {
        const result =
          request.mode === "add"
            ? await store.addIdiom(request.word, request.pinyin, "")
            : await store.updatePinyin(request.word, request.pinyin);
        if (!outcomeChanged(result.outcome)) {
          return { ok: false, message: result.outcome.errors[0] ?? "" };
        }
        model.adopt(result.snapshot);
        return { ok: true, message: "" };
      } catch (e) {
        return { ok: false, message: errorMessage(e) };
      }
    },

    dispose(): void {
      state.session?.dispose();
    },
  };
  return model;
}
