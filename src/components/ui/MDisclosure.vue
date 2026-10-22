<script setup lang="ts">
// 折叠组（SwiftUI 的 DisclosureGroup）：小箭头 + 标题（semibold 14），点标题行展开 / 收起。
import { ref, useId } from "vue";
import Icon from "./Icon.vue";

const props = withDefaults(defineProps<{ title: string; modelValue?: boolean }>(), { modelValue: undefined });
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();

const inner = ref(false);
const open = () => (props.modelValue === undefined ? inner.value : props.modelValue);
const id = useId();

function toggle(): void {
  const next = !open();
  inner.value = next;
  emit("update:modelValue", next);
}
</script>

<template>
  <section class="m-disclosure" :class="{ 'is-open': open() }">
    <button class="m-disclosure__head" type="button" :aria-expanded="open()" :aria-controls="id" @click="toggle">
      <Icon class="m-disclosure__chevron" name="chevron.down" weight="semibold" />
      <span class="m-disclosure__title">{{ title }}</span>
    </button>
    <div v-show="open()" :id="id" class="m-disclosure__body">
      <slot />
    </div>
  </section>
</template>
