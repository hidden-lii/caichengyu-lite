// 开发 / 截图用的固定场景，对应 mac 版 `App/SnapshotRunner.swift`：
// 答案设为「合作无间」，两条猜测「茫然无知」「无中生有」的标记都按类 Wordle 规则对答案自动推出，
// 第一条展开、第二条折叠，选中答案那张候选。只在开发模式下由 main.ts 动态引入，不进发布包。

import { createApp, h } from "vue";
import type { AppModel, SettingsTab } from "../app/model";
import type { CharData, MarkState } from "../core";
import AppearanceSettings from "../components/settings/AppearanceSettings.vue";
import {
  clonePalette,
  defaultTheme,
  fontFamily,
  fontKaiti,
  fromHex24,
  paletteNamed,
  themeStore,
} from "../theme";

export type SceneName =
  | "main"
  | "empty"
  | "menu"
  | "detail"
  | "settings-lexicon"
  | "settings-appearance"
  | "appearance-builtin"
  | "custom-main"
  | "custom-appearance";

const SCENES: readonly SceneName[] = [
  "main",
  "empty",
  "menu",
  "detail",
  "settings-lexicon",
  "settings-appearance",
  "appearance-builtin",
  "custom-main",
  "custom-appearance",
];

export function sceneFromName(name: string | null | undefined): SceneName | null {
  return SCENES.includes(name as SceneName) ? (name as SceneName) : null;
}

export function sceneFromUrl(search: string = location.search): SceneName | null {
  const name = new URLSearchParams(search).get("scene");
  return SCENES.includes(name as SceneName) ? (name as SceneName) : null;
}

/** 类 Wordle：先标 hit，再对剩余按计数标 present，其余 absent。 */
function wordle<T>(guess: T[], answer: T[]): MarkState[] {
  const res: MarkState[] = guess.map(() => "absent");
  const remain = new Map<T, number>();
  for (let i = 0; i < guess.length; i++) {
    if (guess[i] === answer[i]) res[i] = "hit";
    else remain.set(answer[i]!, (remain.get(answer[i]!) ?? 0) + 1);
  }
  for (let i = 0; i < guess.length; i++) {
    if (res[i] === "hit") continue;
    const k = remain.get(guess[i]!) ?? 0;
    if (k > 0) {
      res[i] = "present";
      remain.set(guess[i]!, k - 1);
    }
  }
  return res;
}

function wordleMarks(guess: CharData[], answer: CharData[]) {
  const c = wordle(guess.map((x) => x.c), answer.map((x) => x.c));
  const s = wordle(guess.map((x) => x.sm), answer.map((x) => x.sm));
  const y = wordle(guess.map((x) => x.ym), answer.map((x) => x.ym));
  const t = wordle(guess.map((x) => x.tone), answer.map((x) => x.tone));
  return guess.map((_, i) => ({ char: c[i]!, sm: s[i]!, ym: y[i]!, tone: t[i]! }));
}

const ANSWER = "合作无间";

async function buildMainScene(model: AppModel): Promise<void> {
  const session = model.state.session;
  const snapshot = model.state.snapshot;
  if (!session || !snapshot) throw new Error("场景需要词库已就绪");
  const answerRow = snapshot.table.rowForWord(ANSWER);
  if (answerRow === null) throw new Error(`词库里没有「${ANSWER}」`);
  const answerChars = snapshot.table.chars(answerRow);

  for (const word of ["茫然无知", "无中生有"]) {
    session.state.wordInput = word;
    session.loadWord();
    const draft = session.state.draft;
    if (!draft) continue;
    wordleMarks(draft.chars, answerChars).forEach((t, pos) => {
      session.setMark(pos, "char", t.char);
      session.setMark(pos, "sm", t.sm);
      session.setMark(pos, "ym", t.ym);
      session.setMark(pos, "tone", t.tone);
    });
    session.commitGuess();
  }
  session.toggleHistoryExpanded(0); // 第一条展开（完整芯片），第二条保持折叠
  await session.waitForFilter();
  session.selectCandidate(ANSWER); // 选中答案那一张候选
  await session.waitForFilter();
}

/**
 * 以墨宣为底建一套自定义主题「我的墨宣」，改颜色 / 形状，字体换成 Hiragino Sans GB + 楷体字头 + 放大 1.15
 * （= SnapshotRunner.swift「2. 外观」）。全程只改内存里的 ref，不走 select / updateCurrentCustom，因此不会写 appearance.json。
 */
function applyCustomAppearance(): void {
  const ink = paletteNamed("ink");
  if (!ink) throw new Error("找不到内置主题 ink");
  const p = clonePalette(ink);
  p.id = "custom-snapshot";
  p.baseID = ink.id;
  p.name = "我的墨宣";
  p.tagline = "自定义";
  p.accent = fromHex24(0x1f7a8c);
  p.accentSoft = fromHex24(0xd6ebef);
  p.hit = fromHex24(0x2e9e8f);
  p.cardRadius = 14;
  p.chipRadius = 9;
  p.capsuleButtons = true;
  p.shadowOpacity = 0.1;
  themeStore.customThemes.value = [p];
  themeStore.selectedID.value = p.id;
  themeStore.previewPalette(p);
  themeStore.fonts.value = { ui: fontFamily("Hiragino Sans GB"), word: { ...fontKaiti }, scale: 1.15 };
}

/**
 * 把外观页单独放进一个固定尺寸（640 × height）的容器，贴在窗口左上角盖住主界面——
 * 对应 Swift 里 `ThemedContainer { AppearanceSettingsView(height:) }`。截图时用 `--clip-selector "#cc-scene-host"`。
 */
function mountAppearanceHost(height: number, openAllGroups: boolean): void {
  document.getElementById("cc-scene-host")?.remove();
  const host = document.createElement("div");
  host.id = "cc-scene-host";
  Object.assign(host.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "640px",
    height: `${height}px`,
    zIndex: "9999",
    overflow: "hidden",
    background: "var(--cc-bg)",
  });
  document.body.appendChild(host);
  createApp({ render: () => h(AppearanceSettings, { height, openAllGroups }) }).mount(host);
}

export async function applyScene(scene: SceneName, model: AppModel): Promise<void> {
  if (scene === "empty") return;
  if (scene === "appearance-builtin") {
    // 内置主题被选中、默认字体：只读提示（只改内存，不落盘）
    themeStore.fonts.value = { ui: { kind: "system" }, word: { kind: "songti" }, scale: 1 };
    themeStore.selectedID.value = defaultTheme.id;
    themeStore.previewPalette(defaultTheme);
    mountAppearanceHost(640, false);
    return;
  }
  await buildMainScene(model);
  switch (scene) {
    case "custom-main":
      applyCustomAppearance();
      break;
    case "custom-appearance":
      applyCustomAppearance();
      mountAppearanceHost(1750, true);
      break;
    case "menu":
      model.state.themeMenuOpen = true;
      break;
    case "detail": {
      const session = model.state.session!;
      session.setMark(1, "char", "present");
      session.setComboKind(2, "comboTone");
      session.state.showDetailPanel = true;
      break;
    }
    case "settings-lexicon":
    case "settings-appearance": {
      const tab: SettingsTab = scene === "settings-lexicon" ? "lexicon" : "appearance";
      model.openSettings(tab);
      break;
    }
    default:
      break;
  }
}
