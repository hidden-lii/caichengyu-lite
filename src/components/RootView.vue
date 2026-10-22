<script setup lang="ts">
// 根视图（= RootView.swift）：主题的对角渐变背景；词库就绪后渲染「猜成语」工作台，加载中 / 失败态自带应用栏；
// 外观菜单悬浮在整个界面之上（点其它地方收起）；设置弹层无条件挂载（自带模态）。
// Tauri 没有原生菜单，所以 ⌘,（Windows / Linux 上是 Ctrl+,）在这里自己监听，打开设置。
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useAppModel } from "../app/context";
import AppBar from "./AppBar.vue";
import DeduceView from "./deduce/DeduceView.vue";
import SettingsView from "./SettingsView.vue";
import ThemeMenu from "./ThemeMenu.vue";
import { MSpinner } from "./ui";

const model = useAppModel();

// 命中缓存时通常几十毫秒就好，250ms 之后才显示转圈和进度文案，避免一闪而过
const showSpinner = ref(false);
let spinnerTimer: number | undefined;

function closeThemeMenu(): void {
  model.state.themeMenuOpen = false;
}

/** ⌘,（macOS）/ Ctrl+,（Windows、Linux）；浏览器里（web）两者都认。 */
function isSettingsShortcut(e: KeyboardEvent): boolean {
  if (e.isComposing || e.altKey || e.shiftKey) return false;
  if (e.key !== "," && e.code !== "Comma") return false;
  switch (document.documentElement.dataset.platform) {
    case "macos":
      return e.metaKey && !e.ctrlKey;
    case "windows":
    case "linux":
      return e.ctrlKey && !e.metaKey;
    default:
      return e.metaKey !== e.ctrlKey;
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (isSettingsShortcut(e)) {
    e.preventDefault();
    // 别的模态层打开时不弹的守卫在 openSettings 里
    if (!model.state.settingsOpen) model.openSettings();
    return;
  }
  // 外观菜单：Esc 收起（= onExitCommand）
  if (e.key === "Escape" && model.state.themeMenuOpen && !e.isComposing) {
    e.preventDefault();
    closeThemeMenu();
  }
}

onMounted(() => {
  void model.start();
  spinnerTimer = window.setTimeout(() => (showSpinner.value = true), 250);
  window.addEventListener("keydown", onKeydown);
});
onBeforeUnmount(() => {
  window.clearTimeout(spinnerTimer);
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div class="root">
    <div class="root__content">
      <DeduceView v-if="model.state.phase === 'ready' && model.state.session" :session="model.state.session" />

      <div v-else-if="model.state.phase === 'loading'" class="root__page">
        <AppBar><div class="root__probe" /></AppBar>
        <div class="root__body">
          <template v-if="showSpinner">
            <MSpinner :size="32" />
            <p class="root__message">{{ model.state.phaseMessage }}</p>
          </template>
        </div>
      </div>

      <div v-else-if="model.state.phase === 'failed'" class="root__page">
        <AppBar><div class="root__probe" /></AppBar>
        <div class="root__body root__body--failed">
          <h1 class="root__failed-title">词库加载失败</h1>
          <p class="root__failed-error m-selectable">{{ model.state.phaseMessage }}</p>
          <p class="root__failed-hint">可在「设置」中重新选择词库来源恢复</p>
        </div>
      </div>
    </div>

    <!-- 外观菜单悬浮在整个界面之上：点菜单以外的任何地方收起 -->
    <div v-if="model.state.themeMenuOpen" class="root__scrim" @click="closeThemeMenu" />
    <Transition name="m-menu">
      <ThemeMenu v-if="model.state.themeMenuOpen" class="root__menu" @close="closeThemeMenu" />
    </Transition>

    <SettingsView />
  </div>
</template>

<style scoped>
.root {
  position: relative;
  height: 100%;
  overflow: hidden;
  background: var(--cc-bg-gradient, var(--cc-bg));
  color: var(--cc-ink);
}
.root__content {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.root__page {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.root__probe {
  height: 1px;
}
.root__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  gap: 10px;
  min-height: 0;
  padding: 0 24px;
  text-align: center;
}
.root__body--failed {
  gap: 8px;
}
.root__message {
  margin: 0;
  font-family: var(--cc-font-ui);
  font-size: calc(14px * var(--cc-font-scale));
  color: var(--cc-muted);
}
.root__failed-title {
  margin: 0;
  font-family: var(--cc-font-ui);
  font-size: calc(20px * var(--cc-font-scale));
  font-weight: 600;
}
.root__failed-error {
  margin: 0;
  max-width: 100%;
  font-family: var(--cc-font-ui);
  font-size: calc(13px * var(--cc-font-scale));
  color: var(--cc-danger);
  word-break: break-all;
}
.root__failed-hint {
  margin: 0;
  font-family: var(--cc-font-ui);
  font-size: calc(12.5px * var(--cc-font-scale));
  color: var(--cc-muted);
}

/* 点击收起用的透明罩（= Color.black.opacity(0.001)） */
.root__scrim {
  position: absolute;
  inset: 0;
  z-index: 50;
}
.root__menu {
  position: absolute;
  top: 62px;
  right: 20px;
  z-index: 51;
}
</style>
