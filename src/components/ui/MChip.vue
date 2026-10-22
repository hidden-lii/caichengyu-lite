<script setup lang="ts">
// 芯片（可点的小标签）。
//   assist  词库状态芯片（StatusChipStyle）：高 32、圆角 8、1px 描边、muted 文字；里面放小圆点 + 文字
//   poly    多音字读音芯片（PolyChipStyle）：高 24、胶囊；选中 = tonal 底 + 对勾，未选 = 描边 + muted 字；按下缩放 0.94
// 字体：assist 用界面字体 14 medium；poly 用等宽 12（选中加粗）。
import { ref } from "vue";
import Icon from "./Icon.vue";
import { useRipple } from "./ripple";

withDefaults(
  defineProps<{
    variant?: "assist" | "poly";
    /** poly 的选中态 */
    active?: boolean;
    disabled?: boolean;
  }>(),
  { variant: "assist", active: false, disabled: false },
);

const el = ref<HTMLElement | null>(null);
useRipple(el);
</script>

<template>
  <button
    ref="el"
    class="m-chip m-fx"
    :class="[`m-chip--${variant}`, { 'is-active': active }]"
    type="button"
    :disabled="disabled"
    :aria-pressed="variant === 'poly' ? active : undefined"
  >
    <Transition name="m-check">
      <Icon v-if="variant === 'poly' && active" class="m-chip__check" name="checkmark" weight="bold" />
    </Transition>
    <span class="m-chip__label"><slot /></span>
  </button>
</template>
