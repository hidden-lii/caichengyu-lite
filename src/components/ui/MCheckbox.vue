<script setup lang="ts">
// 复选框（词库设置里每一行的勾选，= MaterialIconButtonStyle(size: 28) 包 checkmark.square.fill / square）。
// 选中主色，未选 muted。v-model 是 boolean。
import { computed } from "vue";
import MIconButton from "./MIconButton.vue";

const props = defineProps<{ modelValue: boolean; label?: string; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const tint = computed(() => (props.modelValue ? "var(--cc-accent)" : "var(--cc-muted)"));
</script>

<template>
  <MIconButton
    role="checkbox"
    :aria-checked="modelValue"
    :size="28"
    :icon-size="14.5"
    :icon="modelValue ? 'checkmark.square.fill' : 'square'"
    :tint="tint"
    :label="label ?? (modelValue ? '取消选择' : '加入所选')"
    :disabled="disabled"
    @click="emit('update:modelValue', !modelValue)"
  />
</template>
