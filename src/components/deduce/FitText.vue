<script setup lang="ts">
// 单行文字，放不下时整体等比缩小（= SwiftUI 的 lineLimit(1) + minimumScaleFactor）。
// 字体、字号、字距由外层的 class 决定；这里只量宽度、套 transform: scale()。
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

const props = withDefaults(defineProps<{ text: string; minScale?: number }>(), { minScale: 0.6 });

const box = ref<HTMLElement | null>(null);
const inner = ref<HTMLElement | null>(null);
const scale = ref(1);

function fit(): void {
  const b = box.value;
  const i = inner.value;
  if (!b || !i) return;
  // offsetWidth 不受 transform 影响，量到的永远是缩放前的自然宽度
  const natural = i.offsetWidth;
  const available = b.clientWidth;
  scale.value = natural > available && natural > 0 ? Math.max(props.minScale, available / natural) : 1;
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  fit();
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(fit);
    if (box.value) observer.observe(box.value);
    if (inner.value) observer.observe(inner.value);
  }
});
onBeforeUnmount(() => observer?.disconnect());
watch(
  () => props.text,
  () => void nextTick(fit),
);
</script>

<template>
  <span ref="box" class="dd-fit">
    <span ref="inner" class="dd-fit__inner" :style="scale < 1 ? { transform: `scale(${scale})` } : undefined">{{ text }}</span>
  </span>
</template>
