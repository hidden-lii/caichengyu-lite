<script setup lang="ts">
// 搜索栏（= DeduceView.swift 的 searchBar，M3 Search Bar）：放大镜 + 输入 + 清除 + 「加载」。聚焦：底色变亮、出现 2px 主色环和 e2 阴影。
// 单独成组件：它放在 AppBar 的插槽里，AppBar 对插槽内容的样式规则只会作用到这个组件的根元素，不会波及里面的按钮和输入框。
import { nextTick, ref, watch } from "vue";
import type { DeduceSession } from "../../core";
import { Icon, MButton, MIconButton } from "../ui";

const props = defineProps<{ session: DeduceSession }>();

const input = ref<HTMLInputElement | null>(null);
const inputFocused = ref(false);
/** 最近一次由用户键入的内容；和 state 对不上就说明是程序改的（选候选、加载词） */
let typed = props.session.state.wordInput;

/** 聚焦并整段选中（⌘L、启动时；和 macOS 的 FocusState 一样） */
function focus(): void {
  const el = input.value;
  if (!el) return;
  el.focus({ preventScroll: true });
  el.select();
  // 窗口本身没有焦点时（刚启动、截图）浏览器不会发 focus 事件，聚焦环要按 activeElement 自己置位
  inputFocused.value = document.activeElement === el;
}
defineExpose({ focus });

function onInput(e: Event): void {
  const value = (e.target as HTMLInputElement).value;
  typed = value;
  props.session.state.wordInput = value;
}

function onEnter(e: KeyboardEvent): void {
  if (!e.isComposing) props.session.loadWord();
}

function clearInput(): void {
  typed = "";
  props.session.state.wordInput = "";
  input.value?.focus({ preventScroll: true });
}

/** 点搜索栏的任何空白处（放大镜、边距）都聚焦输入框 */
function onPointerdown(e: PointerEvent): void {
  if ((e.target as HTMLElement).closest("input, button")) return;
  e.preventDefault();
  focus();
}

// 输入框正聚焦时内容被程序改了（点候选、加载词）：和 macOS 一样整段选中，下一次直接键入即可替换
watch(
  () => props.session.state.wordInput,
  (value) => {
    if (value === typed) return;
    typed = value;
    void nextTick(() => {
      if (document.activeElement === input.value) input.value?.select();
    });
  },
);
</script>

<template>
  <div class="dd-search-wrap">
    <!-- data-tauri-drag-region="false"：应用栏整条可拖动窗口，唯独这条输入条不拖，点它只是聚焦输入框 -->
    <div
      class="dd-search"
      :class="{ 'is-focused': inputFocused }"
      data-tauri-drag-region="false"
      @pointerdown="onPointerdown"
    >
      <Icon class="dd-search__icon" name="magnifyingglass" />
      <input
        ref="input"
        class="dd-search__input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        placeholder="已猜成语，如：弹无虚发"
        title="左键对/无 · 右键偏 · 左右同时清除。绿=对 · 紫=偏 · 灰=无"
        :value="session.state.wordInput"
        @input="onInput"
        @keydown.enter="onEnter"
        @focus="inputFocused = true"
        @blur="inputFocused = false"
      />
      <Transition name="dd-pop">
        <MIconButton v-if="session.state.wordInput.length > 0" :size="32" icon="xmark" label="清除输入" @click="clearInput" />
      </Transition>
      <MButton kind="filled" :height="36" @click="session.loadWord()">加载</MButton>
    </div>
  </div>
</template>
