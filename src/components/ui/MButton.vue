<script setup lang="ts">
// 文字按钮（= MaterialUI.swift 的 MaterialButtonStyle / PrimaryButtonStyle / GhostButtonStyle / SecondaryButtonStyle）。
//   filled      实心（主色底）                .mFilled / PrimaryButtonStyle
//   tonal       色调（次要容器底）            .mTonal
//   text        文字（主色字）                .mText / GhostButtonStyle
//   textDanger  文字（红色字）                .mTextDanger / SecondaryButtonStyle
//   filter      过滤芯片：未选描边，选中填充并出现对勾  .mFilter(active:)
// 旧的三个样式都是紧凑尺寸：PrimaryButtonStyle = filled + compact、GhostButtonStyle = text + compact、SecondaryButtonStyle = textDanger + compact。
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import { useRipple } from "./ripple";

export type MButtonKind = "filled" | "tonal" | "text" | "textDanger" | "filter";

const props = withDefaults(
  defineProps<{
    kind?: MButtonKind;
    /** 紧凑尺寸（高 32、字 13） */
    compact?: boolean;
    /** 指定高度（如搜索栏里的「加载」是 36）；省略 = 按 kind / compact 取默认 */
    height?: number;
    /** filter 的选中态 */
    active?: boolean;
    disabled?: boolean;
    type?: "button" | "submit";
  }>(),
  { kind: "filled", compact: false, height: undefined, active: false, disabled: false, type: "button" },
);

const el = ref<HTMLElement | null>(null);
useRipple(el);

const isChip = computed(() => props.kind === "filter");
const h = computed(() => props.height ?? (isChip.value ? 32 : props.compact ? 32 : 40));
const padH = computed(() => {
  switch (props.kind) {
    case "filled":
    case "tonal":
      return props.compact ? 16 : h.value < 40 ? 20 : 24;
    case "text":
    case "textDanger":
      return props.compact ? 10 : 12;
    default:
      return 12;
  }
});
const style = computed(() => ({
  "--m-h": `${h.value}px`,
  "--m-pad": `${padH.value}px`,
  "--m-fs": `${props.compact ? 13 : 14}px`,
}));
</script>

<template>
  <button
    ref="el"
    class="m-btn m-fx"
    :class="[`m-btn--${kind}`, { 'is-active': kind === 'filter' && active }]"
    :style="style"
    :type="type"
    :disabled="disabled"
  >
    <Transition name="m-check">
      <Icon v-if="kind === 'filter' && active" class="m-btn__check" name="checkmark" weight="bold" />
    </Transition>
    <span v-if="$slots.icon" class="m-btn__icon"><slot name="icon" /></span>
    <span class="m-btn__label"><slot /></span>
  </button>
</template>
