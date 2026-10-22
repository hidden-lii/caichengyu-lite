<script setup lang="ts">
// 标记芯片（= MarkChips.swift 的 MarkChip）：显示一个部件（字 / 声母 / 韵母 / 声调 / 组合），按状态着色，接管鼠标手势。
// 悬停有状态层（字块还会微微放大），按下有水波纹；手势见 markPointer.ts。
import { computed, ref } from "vue";
import type { MarkGesture, MarkState } from "../../core";
import { useManualFX } from "../ui";
import { nodeColors } from "./markColors";
import { createMarkPointer } from "./markPointer";
import { markChipHelp } from "./shortcuts";

const props = withDefaults(
  defineProps<{
    text: string;
    kind?: "char" | "pron" | "combo";
    state?: MarkState | null;
    /** 声/韵/调由「字」自动带出（浅色） */
    auto?: boolean;
    /** 组合下划线（粉色）：该部件属于一个已标「组」的组合 */
    comboUnderline?: boolean;
    /** 折叠态：整体缩小 */
    compact?: boolean;
    help?: string;
  }>(),
  {
    kind: "pron",
    state: null,
    auto: false,
    comboUnderline: false,
    compact: false,
    // 缺省说明按平台现取（见 shortcuts.ts），不能写成这里的静态默认值：它在模块加载时就求值，那时平台还没写到 <html>
    help: undefined,
  },
);
const emit = defineEmits<{ gesture: [gesture: MarkGesture] }>();

const el = ref<HTMLElement | null>(null);
const fx = useManualFX(el, { hoverScale: props.kind === "char" ? 1.05 : 1 });
const pointer = createMarkPointer({
  element: () => el.value,
  onGesture: (g) => emit("gesture", g),
  onPress: (e) => fx.press(e),
  onRelease: () => fx.release(),
});

const title = computed(() => props.help ?? markChipHelp());
const colors = computed(() => nodeColors(props.state, props.auto));
const style = computed(() => ({
  "--chip-bg": colors.value.bg,
  "--chip-fg": colors.value.fg,
  ...fx.style,
}));
</script>

<template>
  <div
    ref="el"
    class="dd-chip m-fx m-fx-manual"
    :class="[`dd-chip--${kind}`, { 'is-compact': compact, 'has-underline': comboUnderline, 'is-pressed': fx.pressed.value }]"
    :style="style"
    role="button"
    :title="title"
    :aria-label="text"
    @pointerdown="pointer.onPointerdown"
    @pointermove="pointer.onPointermove"
    @pointerup="pointer.onPointerup"
    @pointercancel="pointer.onPointercancel"
    @lostpointercapture="pointer.onLostpointercapture"
    @contextmenu="pointer.onContextmenu"
    >{{ text }}</div
  >
</template>
