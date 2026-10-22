<script setup lang="ts">
// 表面（= mSurface / CardBackground）：填色圆角面 + 可选 1px 描边 + 可选阴影。
//   <MSurface fill="var(--cc-surface-high)" :radius="20" elevation="e3">…</MSurface>
//   <MSurface card>…</MSurface>  // = .card()：surface 底 + 1px border + 主题的卡片阴影
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    /** 底色（CSS 颜色）；省略 = surface */
    fill?: string;
    /** 圆角：数字 = px；字符串原样（如 "var(--cc-card-radius)"）。省略 = 主题的卡片圆角 */
    radius?: number | string;
    /** 1px 描边的颜色（CSS 颜色）；省略 = 无 */
    outline?: string;
    /** M3 阴影层级 e1…e4 */
    elevation?: "e1" | "e2" | "e3" | "e4";
    /** 卡片：surface 底 + 1px border + 卡片阴影（Theme.palette.shadowOpacity） */
    card?: boolean;
  }>(),
  { fill: undefined, radius: undefined, outline: undefined, elevation: undefined, card: false },
);

const style = computed(() => {
  const r = props.radius ?? "var(--cc-card-radius)";
  const shadows: string[] = [];
  const outline = props.outline ?? (props.card ? "var(--cc-border)" : undefined);
  if (outline) shadows.push(`inset 0 0 0 1px ${outline}`);
  if (props.elevation) shadows.push(`var(--cc-shadow-${props.elevation})`);
  else if (props.card) shadows.push("var(--cc-card-shadow)");
  return {
    background: props.fill ?? "var(--cc-surface)",
    borderRadius: typeof r === "number" ? `${r}px` : r,
    boxShadow: shadows.length ? shadows.join(", ") : undefined,
  };
});
</script>

<template>
  <div class="m-surface" :style="style"><slot /></div>
</template>
