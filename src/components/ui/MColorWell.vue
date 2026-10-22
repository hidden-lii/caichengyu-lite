<script setup lang="ts">
// 取色器（SwiftUI `ColorPicker(supportsOpacity: true)` 在 macOS 上的样子）：药丸形色块按钮，点开浮出一张取色面板
// （饱和度 / 明度方块、色相条、不透明度条、十六进制输入）。自带实现，不依赖 <input type="color">（WebView 里不一定有）。
// v-model 是 RGBA（0…1 分量，见 theme/color.ts）；改动时每次拖动都会 emit。
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from "vue";
import { type RGBA, parseHexString, toHexString } from "../../theme/color";

const props = withDefaults(defineProps<{ modelValue: RGBA; label?: string; supportsOpacity?: boolean }>(), {
  label: undefined,
  supportsOpacity: true,
});
const emit = defineEmits<{ "update:modelValue": [value: RGBA] }>();

// —— HSV 状态（拖动时保留色相，即使饱和度降到 0） ——
const hsv = reactive({ h: 0, s: 0, v: 0, a: 1 });

function rgbToHsv(c: RGBA): { h: number; s: number; v: number } {
  const max = Math.max(c.r, c.g, c.b);
  const min = Math.min(c.r, c.g, c.b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === c.r) h = ((c.g - c.b) / d) % 6;
    else if (max === c.g) h = (c.b - c.r) / d + 2;
    else h = (c.r - c.g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const f = (n: number): number => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: f(5), g: f(3), b: f(1) };
}

const current = computed<RGBA>(() => ({ ...hsvToRgb(hsv.h, hsv.s, hsv.v), a: hsv.a }));

function syncFromModel(): void {
  const c = props.modelValue;
  const cur = current.value;
  // 外部值和当前 hsv 推出的值一致（自己 emit 回来的）就不动，保住色相
  if (Math.abs(cur.r - c.r) < 1e-6 && Math.abs(cur.g - c.g) < 1e-6 && Math.abs(cur.b - c.b) < 1e-6 && cur.a === c.a) return;
  const { h, s, v } = rgbToHsv(c);
  hsv.h = s === 0 || v === 0 ? hsv.h : h;
  hsv.s = s;
  hsv.v = v;
  hsv.a = c.a;
}
watch(() => props.modelValue, syncFromModel, { immediate: true });

function push(): void {
  emit("update:modelValue", { ...current.value });
}

// —— 面板开合与定位 ——
const open = ref(false);
const btn = ref<HTMLElement | null>(null);
const pop = ref<HTMLElement | null>(null);
const pos = reactive({ left: 0, top: 0 });
const host = ref<HTMLElement | null>(null);

function place(): void {
  const b = btn.value?.getBoundingClientRect();
  if (!b) return;
  const w = 232;
  const h = pop.value?.offsetHeight ?? 260;
  // 默认放在色块下面；下面放不下就放上面。弹层根（sheet）里用 fixed 也是相对视口，所以直接用视口坐标
  let top = b.bottom + 8;
  if (top + h > window.innerHeight - 8) top = Math.max(8, b.top - h - 8);
  pos.left = Math.min(Math.max(8, b.left), window.innerWidth - w - 8);
  pos.top = top;
}

async function toggle(): Promise<void> {
  if (open.value) return close();
  // 挂在最近的模态根里（否则会被 inert 掉）
  host.value = (btn.value?.closest(".m-modal-root") as HTMLElement | null) ?? document.body;
  open.value = true;
  await nextTick();
  place();
  hexText.value = hex.value;
}
function close(): void {
  open.value = false;
  btn.value?.focus();
}

function onDocDown(e: PointerEvent): void {
  const t = e.target as Node;
  if (pop.value?.contains(t) || btn.value?.contains(t)) return;
  open.value = false;
}
function onKey(e: KeyboardEvent): void {
  if (e.key === "Escape" && open.value) {
    e.stopPropagation();
    e.preventDefault();
    close();
  }
}
watch(open, (o) => {
  if (o) {
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
  } else {
    document.removeEventListener("pointerdown", onDocDown, true);
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", place);
    window.removeEventListener("scroll", place, true);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onDocDown, true);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", place);
  window.removeEventListener("scroll", place, true);
});

// —— 拖动 ——
function drag(e: PointerEvent, move: (x: number, y: number, rect: DOMRect) => void): void {
  const el = e.currentTarget as HTMLElement;
  const rect = el.getBoundingClientRect();
  el.setPointerCapture(e.pointerId);
  const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
  const run = (ev: PointerEvent): void => {
    move(clamp01((ev.clientX - rect.left) / rect.width), clamp01((ev.clientY - rect.top) / rect.height), rect);
    push();
  };
  run(e);
  const up = (): void => {
    el.removeEventListener("pointermove", run);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", up);
  };
  el.addEventListener("pointermove", run);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", up);
}
const dragSV = (e: PointerEvent): void =>
  drag(e, (x, y) => {
    hsv.s = x;
    hsv.v = 1 - y;
  });
const dragHue = (e: PointerEvent): void => drag(e, (x) => void (hsv.h = x * 360));
const dragAlpha = (e: PointerEvent): void => drag(e, (x) => void (hsv.a = Math.round(x * 255) / 255));

// —— 十六进制 ——
const hex = computed(() => toHexString(props.supportsOpacity ? current.value : { ...current.value, a: 1 }));
const hexText = ref("");
watch(hex, (h) => {
  if (document.activeElement !== hexInput.value) hexText.value = h;
});
const hexInput = ref<HTMLInputElement | null>(null);
function commitHex(): void {
  const c = parseHexString(hexText.value);
  if (c) {
    const { h, s, v } = rgbToHsv(c);
    hsv.h = s === 0 || v === 0 ? hsv.h : h;
    hsv.s = s;
    hsv.v = v;
    hsv.a = props.supportsOpacity ? c.a : 1;
    push();
  }
  hexText.value = hex.value;
}

const hueColor = computed(() => {
  const c = hsvToRgb(hsv.h, 1, 1);
  return `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})`;
});
const opaqueCss = computed(() => {
  const c = current.value;
  return `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)})`;
});
const fullCss = computed(() => {
  const c = current.value;
  return `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)} / ${c.a})`;
});
const wellCss = computed(() => {
  const c = props.modelValue;
  return `rgb(${Math.round(c.r * 255)} ${Math.round(c.g * 255)} ${Math.round(c.b * 255)} / ${c.a})`;
});
</script>

<template>
  <span class="m-well-wrap">
    <button
      ref="btn"
      class="m-well"
      type="button"
      :aria-label="label"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <span class="m-well__swatch">
        <span class="m-well__color" :style="{ background: wellCss }" />
      </span>
    </button>
    <Teleport v-if="open && host" :to="host">
      <div
        ref="pop"
        class="m-colorpop"
        role="dialog"
        :aria-label="label ?? '取色'"
        :style="{ left: `${pos.left}px`, top: `${pos.top}px` }"
      >
        <div
          class="m-colorpop__sv"
          :style="{ background: hueColor }"
          @pointerdown.prevent="dragSV"
        >
          <span class="m-colorpop__sv-white" />
          <span class="m-colorpop__sv-black" />
          <span
            class="m-colorpop__knob"
            :style="{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: opaqueCss }"
          />
        </div>
        <div class="m-colorpop__bar m-colorpop__hue" @pointerdown.prevent="dragHue">
          <span class="m-colorpop__knob" :style="{ left: `${(hsv.h / 360) * 100}%`, background: hueColor }" />
        </div>
        <div v-if="supportsOpacity" class="m-colorpop__bar m-colorpop__alpha" @pointerdown.prevent="dragAlpha">
          <span class="m-colorpop__alpha-fill" :style="{ background: `linear-gradient(to right, transparent, ${opaqueCss})` }" />
          <span class="m-colorpop__knob" :style="{ left: `${hsv.a * 100}%`, background: fullCss }" />
        </div>
        <div class="m-colorpop__row">
          <span class="m-colorpop__preview"><span :style="{ background: fullCss }" /></span>
          <input
            ref="hexInput"
            v-model="hexText"
            class="m-colorpop__hex"
            spellcheck="false"
            aria-label="十六进制颜色"
            @keydown.enter="commitHex"
            @blur="commitHex"
          />
        </div>
      </div>
    </Teleport>
  </span>
</template>
