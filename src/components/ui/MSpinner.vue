<script setup lang="ts">
// 小号转圈（= ProgressView().controlSize(.small)）：12 根短线依次淡出，macOS 风格。尺寸 16px，颜色 = 当前文字颜色。
withDefaults(defineProps<{ size?: number }>(), { size: 16 });
</script>

<template>
  <span class="m-spinner" :style="{ width: `${size}px`, height: `${size}px` }" role="progressbar" aria-busy="true">
    <svg viewBox="0 0 16 16" width="100%" height="100%" aria-hidden="true">
      <line
        v-for="i in 12"
        :key="i"
        x1="8"
        y1="1.6"
        x2="8"
        y2="4.4"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        :transform="`rotate(${(i - 1) * 30} 8 8)`"
        :opacity="0.25 + ((12 - i) / 11) * 0.75"
      />
    </svg>
  </span>
</template>
