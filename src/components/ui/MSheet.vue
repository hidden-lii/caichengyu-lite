<script setup lang="ts">
// 窗口模态弹层（= SwiftUI 的 `.sheet`）：盖在整个窗口之上，关闭之前下面的任何东西（按钮、输入框、快捷键、Tab）都点不到。
// 点右上角的「完成」或按 Esc 关闭（Esc 只关最上层）；焦点圈在弹层里，关闭后还给打开前的元素。
//
// 用法：
//   <MSheet v-model="open" :width="640"> …内容… </MSheet>
// `width`（数字 = px）是面板的基础宽度；高度由内容和 `max-height` 决定，内容超出时自己放 overflow:auto 的区域。
//
// 自动加宽：面板里有横向可滚动的区域（overflow-x 为 auto / scroll）放不下内容时，面板会加宽到刚好放下，
// 但不会超过窗口（最大宽度见 controls.css 的 `.m-sheet--top / --center`）；窗口本身放不下时才留着横向滚动条。
// 只往宽了调、不往回缩（关闭再打开才复位）。内容用 `width: 100%` 跟着面板走，别写死像素宽度。
// `width` 不是数字（如 "50%"）时不做自动加宽。
//
// `placement="top"`（默认）像 macOS 的 sheet 从窗口顶端落下并居中；`"center"` 居中（设置、对话框用）。
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from "vue";
import { useModal } from "./modal";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    /** 面板基础宽度：数字 = px */
    width?: number | string;
    placement?: "top" | "center";
    /** 点遮罩是否关闭（macOS 的 sheet 不会，默认 false） */
    closeOnBackdrop?: boolean;
    /** 按 Esc 是否关闭 */
    closeOnEsc?: boolean;
    /** 无障碍名称 */
    label?: string;
    /** 面板圆角（px），省略 = top 时下两角 12，center 时 20 */
    radius?: number;
  }>(),
  { width: undefined, placement: "top", closeOnBackdrop: false, closeOnEsc: true, label: undefined, radius: undefined },
);
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  close: [];
}>();

const panel = ref<HTMLElement | null>(null);

function close(): void {
  emit("update:modelValue", false);
  emit("close");
}

useModal({
  open: toRef(props, "modelValue"),
  panel,
  onEscape: props.closeOnEsc ? close : undefined,
});

function onBackdrop(): void {
  if (props.closeOnBackdrop) close();
}

// MARK: - 自动加宽

/** 为放下内容在基础宽度上额外加的像素。每次打开从 0 开始（在渲染前复位，关闭时的淡出动画里宽度不会跳）。 */
const extra = ref(0);
watch(
  () => props.modelValue,
  (open) => {
    if (open) extra.value = 0;
  },
);

const panelWidth = computed<string | undefined>(() => {
  const w = props.width;
  if (typeof w === "number") return `${w + extra.value}px`;
  return w;
});

/** 面板里横向可滚动的区域放不下内容的最大缺口（px）：scrollWidth 比 clientWidth 多出来的部分。 */
function horizontalShortfall(root: HTMLElement): number {
  let need = 0;
  // 下拉框里的 <option>（系统字体列表有几百项）不会滚动，跳过
  for (const el of root.querySelectorAll<HTMLElement>("*:not(option):not(optgroup)")) {
    const gap = el.scrollWidth - el.clientWidth;
    if (gap <= 1) continue;
    const overflowX = getComputedStyle(el).overflowX;
    if (overflowX === "auto" || overflowX === "scroll") need = Math.max(need, gap);
  }
  return Math.ceil(need);
}

let fitting = false;
let refit = false;

/** 量一下有没有横向放不下的内容，有就加宽；一次最多试几轮（加宽后内容重排，可能又暴露出别处的缺口）。 */
async function fit(): Promise<void> {
  if (typeof props.width !== "number") return;
  if (fitting) {
    refit = true;
    return;
  }
  fitting = true;
  try {
    for (let i = 0; i < 4; i++) {
      const el = panel.value;
      if (!el) break;
      const need = horizontalShortfall(el);
      if (need <= 0) break;
      const before = el.offsetWidth;
      extra.value += need;
      await nextTick();
      if (el.offsetWidth <= before) {
        // 已经顶到窗口边缘，再加也没用：撤回，剩下的交给滚动条
        extra.value -= need;
        break;
      }
    }
  } finally {
    fitting = false;
  }
  if (refit) {
    refit = false;
    scheduleFit();
  }
}

let raf = 0;
function scheduleFit(): void {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => void fit());
}

let contentObserver: MutationObserver | null = null;
let rootObserver: MutationObserver | null = null;
let fitActive = false;

function startFit(): void {
  if (fitActive) return;
  const el = panel.value;
  if (!el) {
    // 以打开状态直接挂载时，面板要等这一轮渲染完才有
    void nextTick().then(() => {
      if (props.modelValue && panel.value) startFit();
    });
    return;
  }
  fitActive = true;
  // 打开的这一帧就量好，避免先按基础宽度画一帧再变宽
  void fit();
  window.addEventListener("resize", scheduleFit);
  // 内容增减（页签第一次打开、忙碌遮罩、列表增删…）
  contentObserver = new MutationObserver(scheduleFit);
  contentObserver.observe(el, { childList: true, subtree: true });
  // 字号等外观设置写在 <html style> 的 CSS 变量上，改了字号内容会变宽
  rootObserver = new MutationObserver(scheduleFit);
  rootObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
  // 字体（含系统字体）加载完成后字宽会变
  void document.fonts?.ready.then(scheduleFit);
}

function stopFit(): void {
  fitActive = false;
  cancelAnimationFrame(raf);
  window.removeEventListener("resize", scheduleFit);
  contentObserver?.disconnect();
  rootObserver?.disconnect();
  contentObserver = null;
  rootObserver = null;
}

watch(
  () => props.modelValue,
  (open) => (open ? startFit() : stopFit()),
  { flush: "post", immediate: true },
);
onBeforeUnmount(stopFit);
</script>

<template>
  <Teleport to="body">
    <Transition name="m-sheet" appear>
      <div v-if="modelValue" class="m-modal-root" :class="`m-modal-root--${placement}`">
        <div class="m-sheet-scrim" @pointerdown="onBackdrop" />
        <div
          ref="panel"
          class="m-sheet"
          :class="`m-sheet--${placement}`"
          role="dialog"
          aria-modal="true"
          :aria-label="label"
          tabindex="-1"
          :style="{
            width: panelWidth,
            ...(radius !== undefined ? { '--m-sheet-radius': `${radius}px` } : {}),
          }"
        >
          <slot :close="close" />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
