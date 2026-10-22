<script setup lang="ts">
// 滑块（SwiftUI 的 `Slider(value:in:step:)` 在 macOS 上的样子）：6px 圆角轨道（已走过的部分较深）、白色圆角滑块，
// 轨道下面按 step 画一排刻度小点。宽度默认 200。
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    modelValue: number;
    min: number;
    max: number;
    step?: number;
    width?: number;
    label?: string;
    disabled?: boolean;
  }>(),
  { step: 1, width: 200, label: undefined, disabled: false },
);
const emit = defineEmits<{ "update:modelValue": [value: number] }>();

const fraction = computed(() => (props.max > props.min ? (props.modelValue - props.min) / (props.max - props.min) : 0));
const ticks = computed(() => Math.max(1, Math.round((props.max - props.min) / props.step)) + 1);

function onInput(e: Event): void {
  const v = Number((e.target as HTMLInputElement).value);
  // 避免 0.1 + 0.2 之类的浮点尾巴
  const decimals = (String(props.step).split(".")[1] ?? "").length;
  emit("update:modelValue", Number(v.toFixed(decimals)));
}
</script>

<template>
  <div
    class="m-slider"
    :style="{ width: `${width}px`, '--m-frac': fraction, '--m-ticks': ticks }"
    :class="{ 'is-disabled': disabled }"
  >
    <input
      type="range"
      :min="min"
      :max="max"
      :step="step"
      :value="modelValue"
      :disabled="disabled"
      :aria-label="label"
      @input="onInput"
    />
    <span class="m-slider__ticks" aria-hidden="true" />
  </div>
</template>
