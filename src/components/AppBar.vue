<script setup lang="ts">
// 顶部应用栏（= AppBar.swift 的 AppBar + StatusChip）：
// 左侧红绿灯留位（仅 macOS / web）、logo 与标题；中间是默认插槽（搜索栏）；右侧是词库状态标签、外观、设置。
// 整条应用栏都是拖动窗口的热区：<header> 上的 data-tauri-drag-region="deep" 让栏内任何位置按下都能拖动。
// 光写 data-tauri-drag-region（不带 deep）只有点中该元素自己才算，子元素（logo、标题、搜索栏两侧的空白）都不算，
// 所以以前只有栏上下各一小条能拖。按钮、输入框是可点击元素，Tauri 会自动让它们不触发拖动；
// 搜索栏的圆角输入条在 SearchBar 里标了 data-tauri-drag-region="false"，点它只用来聚焦输入框。
// 子元素上不要再单独写 data-tauri-drag-region：不带 deep 的会在向上查找时把整个 deep 区域截断。
import { computed } from "vue";
import { useAppModel } from "../app/context";
import { MChip, MIconButton } from "./ui";

const model = useAppModel();
const healthy = computed(() => model.statusIsHealthy);

function toggleThemeMenu(): void {
  model.state.themeMenuOpen = !model.state.themeMenuOpen;
}
</script>

<template>
  <header class="appbar" data-tauri-drag-region="deep">
    <!-- 红绿灯留位：标题栏隐藏后，红绿灯悬在窗口左上角（Windows / Linux 用系统标题栏，不留） -->
    <div class="appbar__lights" aria-hidden="true" />
    <div class="appbar__brand">
      <span class="appbar__logo" aria-hidden="true">猜</span>
      <span class="appbar__title">猜成语</span>
    </div>
    <div class="appbar__center">
      <slot />
    </div>
    <div class="appbar__trailing">
      <!-- 词库状态（Assist Chip）：小圆点 + 「词库 66,289」。点开设置；悬停看完整说明 -->
      <MChip class="appbar__status" :title="model.statusText + '（点击打开词库设置）'" @click="model.openSettings('lexicon')">
        <span class="appbar__status-body">
          <span class="appbar__dot" :class="healthy ? 'is-ok' : 'is-warn'" aria-hidden="true" />
          <span>{{ model.statusChipText }}</span>
        </span>
      </MChip>
      <MIconButton icon="paintpalette" label="外观" title="外观：明暗、主题色、字头字体" @click="toggleThemeMenu" />
      <MIconButton icon="gearshape" label="设置" title="设置：词库、外观" @click="model.openSettings()" />
    </div>
  </header>
</template>

<style scoped>
.appbar {
  display: flex;
  align-items: center;
  flex: none;
  gap: 18px;
  height: 68px;
  padding: 0 20px 0 18px;
}

.appbar__lights {
  flex: none;
  width: 60px;
  height: 1px;
}
:global(html[data-platform="windows"]) .appbar__lights,
:global(html[data-platform="linux"]) .appbar__lights {
  display: none;
}

/* logo 与标题：不接收指针（不会选中文字），按下落到父元素上，照样算应用栏的拖动热区 */
.appbar__brand {
  display: flex;
  align-items: center;
  flex: none;
  gap: 10px;
}
.appbar__brand > * {
  pointer-events: none;
}
.appbar__logo {
  display: grid;
  place-items: center;
  flex: none;
  width: 36px;
  height: 36px;
  border-radius: 12px;
  background: var(--cc-accent-soft);
  color: var(--cc-on-accent-soft);
  font-family: var(--cc-font-word);
  font-size: calc(21px * var(--cc-font-scale));
  /* Swift 的 .bold 作用在 Songti SC 上落到最粗的「黑体」字重（CSS 800~900），700 会偏细 */
  font-weight: 900;
  line-height: 1;
}
.appbar__title {
  font-family: var(--cc-font-ui);
  font-size: calc(20px * var(--cc-font-scale));
  font-weight: var(--cc-w-medium, 500);
  color: var(--cc-ink);
  white-space: nowrap;
}

/* 中间：搜索栏占满剩余宽度（= center().frame(maxWidth: .infinity)），内容在其中居中 */
.appbar__center {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 0;
  min-width: 0;
}
.appbar__center :slotted(*) {
  flex: 1 1 auto;
  min-width: 0;
}

.appbar__trailing {
  display: flex;
  align-items: center;
  flex: none;
  gap: 4px;
}
/* StatusChip 后面多留 8（.padding(.trailing, 8)） */
.appbar__status {
  margin-right: 8px;
}
.appbar__status-body {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
/* 8 的圆点 + 14 的淡色光晕 */
.appbar__dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  --dot: var(--cc-ok);
  background: var(--dot);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--dot) 28%, transparent);
}
.appbar__dot.is-warn {
  --dot: var(--cc-warn);
}
</style>
