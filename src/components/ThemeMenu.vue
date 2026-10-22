<script setup lang="ts">
// 外观菜单（= AppBar.swift 的 ThemeMenu）：从应用栏右上角弹出的一张 M3 菜单——
// 浅色 / 深色、主题色圆点（整套配色自动生成）、成语字头字体，以及「更多外观设置」。
// 全部直接接在 useTheme() 上，点了即时生效。位置与出场动画由 RootView 的浮层负责。
import { computed } from "vue";
import { useAppModel } from "../app/context";
import { type FontKind, type MaterialSeed, materialSeeds, seedSwatch, toCss, useTheme } from "../theme";
import { Icon, MButton, MSegmented, MSurface, vRipple } from "./ui";

const emit = defineEmits<{ close: [] }>();

const model = useAppModel();
const theme = useTheme();

const current = computed(() => theme.currentMaterial);
const dark = computed(() => current.value?.dark ?? theme.isDark);

const modeOptions = [
  { value: false, label: "浅色" },
  { value: true, label: "深色" },
] as const;

const wordOptions = [
  { value: "songti", label: "宋体" },
  { value: "kaiti", label: "楷体" },
  { value: "system", label: "黑体" },
] as const;
// 当前字头字体若不是这三种（圆体 / 自选字体），一段也不选中
const wordKind = computed<string>(() => {
  const k = theme.fonts.word.kind;
  return k === "songti" || k === "kaiti" || k === "system" ? k : "";
});

const swatchCss = (seed: MaterialSeed): string => toCss(seedSwatch(seed));
const isSelected = (seed: MaterialSeed): boolean => current.value?.seed.id === seed.id;

function more(): void {
  emit("close");
  model.openSettings("appearance");
}
</script>

<template>
  <MSurface
    class="theme-menu"
    fill="var(--cc-surface-high)"
    :radius="20"
    outline="var(--cc-menu-outline)"
    elevation="e3"
    role="dialog"
    aria-label="外观"
  >
    <section class="theme-menu__section">
      <h3 class="theme-menu__title">外观</h3>
      <MSegmented
        :options="modeOptions"
        :model-value="dark"
        label="外观"
        @select="(v: boolean) => theme.selectMaterial({ dark: v })"
      />
    </section>

    <section class="theme-menu__section">
      <h3 class="theme-menu__title">主题色 · 整套配色自动生成</h3>
      <div class="theme-menu__seeds">
        <div v-for="seed in materialSeeds" :key="seed.id" class="theme-menu__seed">
          <div
            class="theme-menu__swatch-wrap"
            :class="{ 'is-selected': isSelected(seed) }"
            :style="{ color: swatchCss(seed) }"
          >
            <button
              v-ripple
              type="button"
              class="theme-menu__swatch m-fx"
              :style="{ background: swatchCss(seed), '--m-tint': '#fff' }"
              :aria-label="seed.name"
              :aria-pressed="isSelected(seed)"
              @click="theme.selectMaterial({ seed })"
            >
              <Icon class="theme-menu__check" name="checkmark" weight="bold" />
            </button>
            <!-- 选中：圆外 3 留白 + 2 同色环（在按钮之外，按下缩放时环不动） -->
            <span class="theme-menu__ring" aria-hidden="true" />
          </div>
          <span class="theme-menu__seed-name">{{ seed.name }}</span>
        </div>
      </div>
    </section>

    <section class="theme-menu__section">
      <h3 class="theme-menu__title">成语字头字体</h3>
      <MSegmented
        :options="wordOptions"
        :model-value="wordKind"
        label="成语字头字体"
        @select="(v: string) => theme.setWordFont({ kind: v as FontKind })"
      />
    </section>

    <div class="theme-menu__more">
      <MButton class="theme-menu__more-btn" kind="text" @click="more">更多外观设置</MButton>
    </div>
  </MSurface>
</template>

<style scoped>
.theme-menu {
  --cc-font-ui: var(--cc-font-ui-w);
  display: flex;
  flex-direction: column;
  gap: 16px;
  width: 316px;
  padding: 16px;
  color: var(--cc-ink);
}

.theme-menu__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.theme-menu__title {
  margin: 0;
  font-family: var(--cc-font-ui);
  font-size: calc(12px * var(--cc-font-scale));
  font-weight: var(--cc-w-medium, 500);
  /* Swift 里写了 .tracking(0.5)，但基准截图里中文并没有被拉开，所以不加字距 */
  line-height: 1.25; /* SwiftUI 的 Text 行高 ≈ 字号 × 1.2（浏览器默认的 normal 对中文偏高） */
  color: var(--cc-muted);
}

/* 主题色圆点：5 个 44 的圆，间距 10，靠左；名字在下面 */
.theme-menu__seeds {
  display: flex;
  align-items: flex-start;
  gap: 10px;
}
.theme-menu__seed {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 44px;
}
.theme-menu__seed-name {
  font-family: var(--cc-font-ui);
  font-size: calc(11.5px * var(--cc-font-scale));
  line-height: 1.25;
  color: var(--cc-muted);
  white-space: nowrap;
}
.theme-menu__swatch-wrap {
  position: relative;
  width: 44px;
  height: 44px;
}
.theme-menu__swatch {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  --m-press-scale: 0.92;
}
.theme-menu__check {
  font-size: 18px;
  color: #fff;
  transform: scale(0.01);
  transition: transform 0.3s var(--m-spring);
}
.is-selected .theme-menu__check {
  transform: scale(1);
}
.theme-menu__ring {
  position: absolute;
  inset: -5px;
  border-radius: 50%;
  box-shadow: inset 0 0 0 2px currentColor;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s ease-out;
}
.theme-menu__swatch-wrap.is-selected .theme-menu__ring {
  opacity: 1;
}

.theme-menu__more {
  display: flex;
  justify-content: flex-end;
}
</style>
