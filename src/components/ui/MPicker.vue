<script setup lang="ts" generic="T extends string | number | boolean">
// 分段选择器（SwiftUI `Picker` 的 .segmented 样式 = macOS 原生分段控件）：灰色轨道、选中的一段更深一点的灰、圆角 6、高 24。
// 设置页里「按钮形状」「标记块」「词库状态条」「系统控件明暗」用它；应用栏 / 外观菜单里的 Material 分段按钮是 MSegmented。
defineProps<{
  options: readonly { value: T; label: string }[];
  modelValue: T;
  width?: number;
  label?: string;
}>();
const emit = defineEmits<{ "update:modelValue": [value: T] }>();
</script>

<template>
  <!-- 外层是 SwiftUI 的 .frame(width:)：分段控件按内容定宽（各段等宽），在这个框里居中 -->
  <div class="m-picker-frame" :style="width ? { width: `${width}px` } : undefined">
  <div class="m-picker" role="radiogroup" :aria-label="label">
    <button
      v-for="o in options"
      :key="String(o.value)"
      class="m-picker__item"
      :class="{ 'is-selected': o.value === modelValue }"
      type="button"
      role="radio"
      :aria-checked="o.value === modelValue"
      @click="emit('update:modelValue', o.value)"
    >
      {{ o.label }}
    </button>
  </div>
  </div>
</template>
