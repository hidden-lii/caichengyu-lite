<script setup lang="ts">
// 扩展 FAB（= MaterialFABStyle）：图标 + 文字 + 快捷键。底色 primary-container，常驻 e3 阴影，悬停抬高到 e4。
// 出场动画：外面包 <Transition name="m-fab">（从右下角弹簧弹出 / 收起，样式在 fx.css）。
import { ref } from "vue";
import { useRipple } from "./ripple";

withDefaults(defineProps<{ disabled?: boolean; type?: "button" | "submit" }>(), { disabled: false, type: "button" });

const el = ref<HTMLElement | null>(null);
useRipple(el);
</script>

<template>
  <button ref="el" class="m-fab m-fx" :type="type" :disabled="disabled">
    <slot />
  </button>
</template>
