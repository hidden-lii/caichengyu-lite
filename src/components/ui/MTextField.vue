<script setup lang="ts">
// 单行输入框（设置页里的「名称」「成语」「读音」「释义」）：plain 文本框 + padding 8×5 + 圆角 6 + 1px 边框。
// 底色默认 field（词库维护的输入框用 surface，传 fill 即可）。
import { ref } from "vue";

defineProps<{
  modelValue: string;
  placeholder?: string;
  /** 底色（CSS 颜色），省略 = field */
  fill?: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: string];
  /** 回车 */
  submit: [];
}>();

const input = ref<HTMLInputElement | null>(null);
defineExpose({ focus: () => input.value?.focus(), select: () => input.value?.select() });
</script>

<template>
  <input
    ref="input"
    class="m-field"
    type="text"
    spellcheck="false"
    autocomplete="off"
    :style="fill ? { background: fill } : undefined"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
    @keydown.enter="!$event.isComposing && emit('submit')"
  />
</template>
