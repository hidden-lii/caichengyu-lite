<script setup lang="ts">
// 卡片式按钮（= MaterialCardButtonStyle：候选卡、可点的行）。
// 底色 surfaceHigh，选中变 accentSoft + 2px 主色环；悬停上浮 1px 并出 e1 阴影；按下缩放 0.98。
import { computed, ref } from "vue";
import { useRipple } from "./ripple";

const props = withDefaults(
  defineProps<{
    selected?: boolean;
    radius?: number;
    /** 未选中底色 / 选中底色 / 前景色 / 选中前景色 / 选中环的颜色（CSS 颜色），省略 = 主题默认 */
    fill?: string;
    selectedFill?: string;
    foreground?: string;
    selectedForeground?: string;
    ringColor?: string;
    disabled?: boolean;
  }>(),
  {
    selected: false,
    radius: 16,
    fill: undefined,
    selectedFill: undefined,
    foreground: undefined,
    selectedForeground: undefined,
    ringColor: undefined,
    disabled: false,
  },
);

const el = ref<HTMLElement | null>(null);
useRipple(el);

const style = computed(() => {
  const s: Record<string, string> = { "--m-radius": `${props.radius}px` };
  if (props.fill) s["--m-fill"] = props.fill;
  if (props.selectedFill) s["--m-selected-fill"] = props.selectedFill;
  if (props.foreground) s["--m-fg"] = props.foreground;
  if (props.selectedForeground) s["--m-selected-fg"] = props.selectedForeground;
  if (props.ringColor) s["--m-ring"] = props.ringColor;
  return s;
});
</script>

<template>
  <button
    ref="el"
    class="m-card-btn m-fx"
    :class="{ 'is-selected': selected }"
    :style="style"
    type="button"
    :disabled="disabled"
    :aria-pressed="selected"
  >
    <slot />
  </button>
</template>
