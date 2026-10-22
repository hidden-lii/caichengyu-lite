<script setup lang="ts">
// 设置弹层的内容（= SettingsContainer.swift 的 SettingsView.body）：
//   标题栏（高 56：设置 / 词库·外观分段 / 完成）+ 分隔线 + 两页。
// 640 宽；高度 620（最小 440、可被窗口高度压缩，最大 900）。
// 去过的页签保持存活（v-show）：来回切换不丢词库页里还没应用的勾选，也不必每次重新载入。
import { computed, reactive, watch } from "vue";
import { useAppModel } from "../../app/context";
import type { SettingsTab } from "../../app/model";
import { MButton, MSegmented } from "../ui";
import AppearanceSettings from "./AppearanceSettings.vue";
import LexiconSettings from "./LexiconSettings.vue";

const model = useAppModel();

const TABS: readonly { value: SettingsTab; label: string }[] = [
  { value: "lexicon", label: "词库" },
  { value: "appearance", label: "外观" },
];

const tab = computed<SettingsTab>({
  get: () => model.state.settingsTab,
  set: (v) => {
    model.state.settingsTab = v;
  },
});

/** 去过的页签（第一次进入时才创建那一页；本组件随弹层创建，所以每次打开都从头记） */
const visited = reactive<Record<SettingsTab, boolean>>({ lexicon: false, appearance: false });
watch(
  tab,
  (t) => {
    visited[t] = true;
  },
  { immediate: true },
);
</script>

<template>
  <!-- data-autofocus：弹层打开时焦点先落在这里（不是某个按钮，免得出现焦点环） -->
  <div class="sb" data-autofocus tabindex="-1">
    <header class="sb-header">
      <h2 class="sb-title">设置</h2>
      <MSegmented v-model="tab" class="sb-seg" :options="TABS" label="设置页签" />
      <div class="sb-done">
        <MButton kind="filled" :height="36" title="关闭设置（Esc）" @click="model.closeSettings()">完成</MButton>
      </div>
    </header>
    <hr class="sb-divider" />
    <div class="sb-pages">
      <div v-if="visited.lexicon" v-show="tab === 'lexicon'" class="sb-page">
        <LexiconSettings />
      </div>
      <div v-if="visited.appearance" v-show="tab === 'appearance'" class="sb-page">
        <AppearanceSettings />
      </div>
    </div>
  </div>
</template>

<style scoped>
.sb {
  display: flex;
  flex-direction: column;
  /* 理想高度 620，窗口矮时压缩到最小 440 */
  flex: 0 1 620px;
  min-height: 440px;
  max-height: 900px;
  width: 100%;
  background: var(--cc-bg);
  color: var(--cc-ink);
  outline: none;
}
.sb:focus-visible {
  outline: none;
}
.sb-header {
  flex: none;
  display: grid;
  grid-template-columns: 1fr 180px 1fr;
  align-items: center;
  height: 56px;
  padding: 0 20px;
}
/* Swift 写的是 serif(18) semibold；汉字变窄由全局 "CC CJK" 别名处理 */
.sb-title {
  margin: 0;
  font-family: var(--cc-font-ui);
  font-size: calc(18px * var(--cc-font-scale));
  font-weight: 600;
  line-height: calc(19.2 / 18);
}
.sb-seg {
  width: 180px;
}
.sb-done {
  justify-self: end;
}
.sb-divider {
  flex: none;
  height: 1px;
  margin: 0;
  border: 0;
  background: color-mix(in srgb, var(--cc-ink) 14%, transparent);
}
.sb-pages {
  position: relative;
  flex: 1 1 0;
  min-height: 0;
}
.sb-page {
  position: absolute;
  inset: 0;
}
</style>
