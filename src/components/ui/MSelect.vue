<script setup lang="ts">
// 下拉选择（SwiftUI `Picker` 的 .menu 样式 = macOS 弹出式按钮）：圆角 6、右侧上下小箭头；弹出的菜单用系统原生的（<select>），
// 所以长列表（系统字体）滚动、键盘检索都是系统自带的。选项用 <option> / <optgroup> 放进默认插槽。
//
//   <MSelect v-model="tag" :width="230"><option value="songti">宋体（默认）</option><optgroup label="…">…</optgroup></MSelect>
import Icon from "./Icon.vue";

defineProps<{ modelValue: string; width?: number; label?: string; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <span class="m-select" :style="width ? { width: `${width}px` } : undefined">
    <select
      class="m-select__control"
      :value="modelValue"
      :aria-label="label"
      :disabled="disabled"
      @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
    >
      <slot />
    </select>
    <span class="m-select__arrows" aria-hidden="true">
      <Icon name="chevron.up" weight="semibold" />
      <Icon name="chevron.down" weight="semibold" />
    </span>
  </span>
</template>
