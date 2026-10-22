<script setup lang="ts">
// 图标按钮（= MaterialIconButtonStyle）：圆形，默认 40，图标 = 尺寸的一半，前景色 muted，按下缩放 0.92。
import { computed, ref } from "vue";
import Icon from "./Icon.vue";
import type { IconName } from "./iconNames";
import { useRipple } from "./ripple";

const props = withDefaults(
  defineProps<{
    /** 直径（px） */
    size?: number;
    /** 前景色（CSS 颜色）；省略 = muted */
    tint?: string;
    /** 内置图标；也可以直接放默认插槽 */
    icon?: IconName;
    /** 图标字号（px）；省略 = 直径的一半 */
    iconSize?: number;
    /** 无障碍名称（= accessibilityLabel） */
    label?: string;
    disabled?: boolean;
    type?: "button" | "submit";
  }>(),
  { size: 40, tint: undefined, icon: undefined, iconSize: undefined, label: undefined, disabled: false, type: "button" },
);

const el = ref<HTMLElement | null>(null);
useRipple(el);

const style = computed(() => ({
  "--m-size": `${props.size}px`,
  "--m-icon-fs": `${props.iconSize ?? props.size * 0.5}px`,
  ...(props.tint ? { color: props.tint } : {}),
}));
</script>

<template>
  <button
    ref="el"
    class="m-icon-btn m-fx"
    :style="style"
    :type="type"
    :disabled="disabled"
    :aria-label="label"
    :title="label"
  >
    <slot><Icon v-if="icon" :name="icon" /></slot>
  </button>
</template>
