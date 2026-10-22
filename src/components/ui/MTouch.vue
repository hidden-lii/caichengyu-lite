<script setup lang="ts">
// 自带底色的按钮（= MaterialTouchStyle / MaterialRowStyle）：不改外观，只在外面叠上状态层、按下缩放与水波纹。
// 标签自己画背景（色块、卡片、整行）时用它。`radius` 决定被裁剪的形状，要和标签自己的圆角一致。
import { computed, ref } from "vue";
import { useRipple } from "./ripple";

const props = withDefaults(
  defineProps<{
    /** 圆角（px）；circle 为真时忽略 */
    radius?: number;
    /** 状态层 / 水波纹的颜色（= 前景色）；省略 = 当前文字颜色 */
    tint?: string;
    pressScale?: number;
    circle?: boolean;
    /** 占满父级宽度（卡片网格里用） */
    block?: boolean;
    /** 渲染成什么标签（默认 button；整行可点但里面有别的按钮时可以用 div） */
    tag?: string;
    disabled?: boolean;
    type?: "button" | "submit";
  }>(),
  { radius: 0, tint: undefined, pressScale: 0.97, circle: false, block: false, tag: "button", disabled: false, type: "button" },
);

const el = ref<HTMLElement | null>(null);
useRipple(el);

const style = computed(() => ({
  borderRadius: props.circle ? "50%" : `${props.radius}px`,
  "--m-press-scale": String(props.pressScale),
  ...(props.tint ? { "--m-tint": props.tint } : {}),
}));
</script>

<template>
  <component
    :is="tag"
    ref="el"
    class="m-touch m-fx"
    :class="{ 'm-touch--block': block }"
    :style="style"
    :type="tag === 'button' ? type : undefined"
    :disabled="tag === 'button' ? disabled : undefined"
    :role="tag === 'button' ? undefined : 'button'"
    :tabindex="tag === 'button' ? undefined : 0"
  >
    <slot />
  </component>
</template>
