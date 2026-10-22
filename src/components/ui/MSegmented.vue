<script setup lang="ts" generic="T extends string | number | boolean">
// 分段按钮（= MaterialSegmented，M3 Segmented Button）：外框胶囊，选中的一段填充（tonal）并出现对勾。
// 高 40，描边 1px outline，段间 1px outline 分隔线；每段有悬停 / 按下状态层与水波纹（按下不缩放）。
import { ref } from "vue";
import Icon from "./Icon.vue";
import { addRipple, localPoint, prefersReducedMotion } from "./ripple";

const props = defineProps<{
  /** 选项：value + 显示文字 */
  options: readonly { value: T; label: string }[];
  /** 当前选中的 value（v-model） */
  modelValue: T;
  /** 无障碍名称 */
  label?: string;
}>();
const emit = defineEmits<{
  "update:modelValue": [value: T];
  /** 点了某一段（含点已选中的那段） */
  select: [value: T];
}>();

const items = ref<HTMLElement[]>([]);

function pick(v: T): void {
  emit("select", v);
  if (v !== props.modelValue) emit("update:modelValue", v);
}

function onDown(e: PointerEvent): void {
  if (e.button !== 0 || prefersReducedMotion()) return;
  const el = e.currentTarget as HTMLElement;
  addRipple(el, localPoint(el, e));
}

// 方向键在段间移动（radiogroup 的标准键盘行为）
function onKey(e: KeyboardEvent, i: number): void {
  const n = props.options.length;
  let j = -1;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") j = (i + 1) % n;
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") j = (i - 1 + n) % n;
  if (j < 0) return;
  e.preventDefault();
  pick(props.options[j]!.value);
  items.value[j]?.focus();
}
</script>

<template>
  <div class="m-seg" role="radiogroup" :aria-label="label">
    <template v-for="(o, i) in options" :key="String(o.value)">
      <span v-if="i > 0" class="m-seg__divider" aria-hidden="true" />
      <button
        :ref="(el) => { if (el) items[i] = el as HTMLElement; }"
        class="m-seg__item m-fx"
        :class="{ 'is-selected': o.value === modelValue }"
        type="button"
        role="radio"
        :aria-checked="o.value === modelValue"
        :tabindex="o.value === modelValue ? 0 : -1"
        @pointerdown="onDown"
        @click="pick(o.value)"
        @keydown="onKey($event, i)"
      >
        <Transition name="m-check">
          <Icon v-if="o.value === modelValue" class="m-seg__check" name="checkmark" weight="bold" />
        </Transition>
        <span class="m-seg__label">{{ o.label }}</span>
      </button>
    </template>
  </div>
</template>
