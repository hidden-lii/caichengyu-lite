<script setup lang="ts">
// 一排字位列：N 等分铺满可用宽度；放不下（字数多 / 窗口窄）时每列保持最小宽度并横向滚动（= WrapLayout.swift 的 CharRow）。
// 列在顶部对齐（各列高度不同：多音字多一行读音切换）。用法：<CharRow :count="4" :min-column-width="112" :spacing="10"><template #default="{ i }">…</template></CharRow>
import { computed } from "vue";

const props = withDefaults(defineProps<{ count: number; minColumnWidth?: number; spacing?: number }>(), {
  minColumnWidth: 120,
  spacing: 8,
});

defineSlots<{ default(props: { i: number }): unknown }>();

const style = computed(() => {
  const n = Math.max(1, props.count);
  return {
    gridTemplateColumns: `repeat(${n}, minmax(${props.minColumnWidth}px, 1fr))`,
    gap: `${props.spacing}px`,
    minWidth: `${props.minColumnWidth * n + props.spacing * (n - 1)}px`,
  };
});
</script>

<template>
  <div class="dd-charrow m-no-scrollbar">
    <div class="dd-charrow__inner" :style="style">
      <template v-for="i in count" :key="i">
        <slot :i="i - 1" />
      </template>
    </div>
  </div>
</template>
