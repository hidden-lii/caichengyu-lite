<script setup lang="ts">
// 忙碌遮罩（写库进行中：DeduceView.busyOverlay；词库设置里的忙碌遮罩：LexiconSettingsView.busyOverlay）。
//   window  整窗变暗 34% + 居中一张 surfaceHigh 圆角 24 的卡（转圈 + 粗体说明 + 小字提示），吃掉所有鼠标事件
//   panel   所在面板变暗 8% + 居中一张 .card(radius: 10)（转圈 + 粗体说明）
// 位置：absolute，铺满最近的 position 非 static 的祖先（整窗用的话放在根容器里）。
import MSpinner from "./MSpinner.vue";

withDefaults(
  defineProps<{
    /** 说明文字（粗体） */
    text: string;
    /** 小字提示（window 样式才有） */
    detail?: string;
    variant?: "window" | "panel";
  }>(),
  { detail: undefined, variant: "window" },
);
</script>

<template>
  <div class="m-busy" :class="`m-busy--${variant}`" role="alert" aria-live="polite">
    <div class="m-busy__card">
      <MSpinner />
      <div class="m-busy__text">
        <div class="m-busy__title">{{ text }}</div>
        <div v-if="detail && variant === 'window'" class="m-busy__detail">{{ detail }}</div>
      </div>
    </div>
  </div>
</template>
