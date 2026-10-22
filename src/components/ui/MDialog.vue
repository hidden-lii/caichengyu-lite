<script setup lang="ts">
// 确认对话框（= SwiftUI 的 `.alert`，Material 外观）：标题 + 说明 + 两个文字按钮（取消 / 确认）。
// 破坏性操作（destructive）的确认按钮是红色文字；Enter = 确认（defaultAction），Esc = 取消。
//
//   <MDialog v-model="confirmDelete" title="删除主题「我的」？" message="删除后会回到桌面版主题，且无法恢复。"
//            confirm-text="删除" destructive @confirm="deleteIt" />
import { nextTick, ref, watch } from "vue";
import MButton from "./MButton.vue";
import MSheet from "./MSheet.vue";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    title: string;
    message?: string;
    confirmText?: string;
    cancelText?: string;
    /** 确认按钮是红色（删除、清空）；同时默认焦点落在「取消」上更安全，但 Enter 仍是确认 */
    destructive?: boolean;
    /** 只有一个按钮（纯提示） */
    hideCancel?: boolean;
  }>(),
  { message: undefined, confirmText: "确定", cancelText: "取消", destructive: false, hideCancel: false },
);
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  confirm: [];
  cancel: [];
}>();

const confirmBtn = ref<{ $el: HTMLElement } | null>(null);

function confirm(): void {
  emit("update:modelValue", false);
  emit("confirm");
}
function cancel(): void {
  emit("update:modelValue", false);
  emit("cancel");
}

// 默认焦点在确认按钮上（Enter 即确认）
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    await nextTick();
    confirmBtn.value?.$el?.focus?.();
  },
  { flush: "post" },
);

function onKeydown(e: KeyboardEvent): void {
  if (e.key === "Enter" && !e.isComposing && e.target instanceof HTMLElement && e.target.tagName !== "BUTTON") {
    e.preventDefault();
    confirm();
  }
}
</script>

<template>
  <MSheet
    :model-value="modelValue"
    placement="center"
    :width="320"
    :radius="28"
    :label="title"
    @update:model-value="(v: boolean) => !v && cancel()"
  >
    <div class="m-dialog" @keydown="onKeydown">
      <h2 class="m-dialog__title">{{ title }}</h2>
      <p v-if="message" class="m-dialog__message">{{ message }}</p>
      <div class="m-dialog__actions">
        <MButton v-if="!hideCancel" kind="text" compact @click="cancel">{{ cancelText }}</MButton>
        <MButton ref="confirmBtn" :kind="destructive ? 'textDanger' : 'text'" compact @click="confirm">
          {{ confirmText }}
        </MButton>
      </div>
    </div>
  </MSheet>
</template>
