// 水波纹与「按下特效」的 JS 部分（= MaterialUI.swift 的 RippleFX / RippleLayer / MaterialManualFX）。
//
// 视觉全在 src/styles/fx.css 里（状态层、水波纹动画、按下缩放）；这里只负责：
//   · addRipple(host, point)        在控件里塞一个水波纹（从点击位置向外扩散，被控件形状裁剪）
//   · useRipple(el)                 给按钮类控件：指针按下 / 键盘触发时自动画水波纹
//   · vRipple                       同上，指令形式：<div class="m-fx" v-ripple>
//   · useManualFX(el, options)      给非按钮元素（标记芯片）：按下 / 抬起由外部事件驱动（MaterialPressFX 的外部驱动版本）
//
// 「减弱动态效果」（prefers-reduced-motion）打开时不画水波纹，状态层仍保留（同 Swift）。

import { type Directive, type Ref, onBeforeUnmount, onMounted, readonly, ref } from "vue";

/** 水波纹扩散 0.65s，多留一点再移除，避免尾巴被截断（同 Swift 的 800ms） */
const REMOVE_AFTER_MS = 800;

export interface LocalPoint {
  x: number;
  y: number;
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
}

/**
 * 在 host 里画一个水波纹。`point` 是 host 本地坐标（左上为原点，未缩放的 CSS 像素）；省略 = 中心（键盘触发或拿不到指针位置时）。
 * 圆的直径 = 2 × 点到最远角的距离，所以一定能铺满整个控件。
 */
export function addRipple(host: HTMLElement, point?: LocalPoint | null): void {
  if (prefersReducedMotion() || isDisabled(host)) return;
  const w = host.offsetWidth;
  const h = host.offsetHeight;
  const ox = point?.x ?? w / 2;
  const oy = point?.y ?? h / 2;
  const d = Math.max(2, 2 * Math.hypot(Math.max(ox, w - ox), Math.max(oy, h - oy)));

  let layer = host.querySelector<HTMLElement>(":scope > .m-ripples");
  if (!layer) {
    layer = document.createElement("span");
    layer.className = "m-ripples";
    layer.setAttribute("aria-hidden", "true");
    host.appendChild(layer);
  }
  const ripple = document.createElement("span");
  ripple.className = "m-ripple";
  ripple.style.width = ripple.style.height = `${d}px`;
  ripple.style.left = `${ox - d / 2}px`;
  ripple.style.top = `${oy - d / 2}px`;
  layer.appendChild(ripple);
  const owner = layer;
  window.setTimeout(() => {
    ripple.remove();
    if (!owner.firstChild) owner.remove();
  }, REMOVE_AFTER_MS);
}

/** 指针事件 → host 本地坐标（控件正被缩放时，用 offsetWidth / 实际宽度换算回未缩放的坐标） */
export function localPoint(host: HTMLElement, e: { clientX: number; clientY: number }): LocalPoint {
  const r = host.getBoundingClientRect();
  const sx = r.width > 0 ? host.offsetWidth / r.width : 1;
  const sy = r.height > 0 ? host.offsetHeight / r.height : 1;
  return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sy };
}

/** 给按钮类控件：左键 / 触摸按下时在按下的位置画水波纹；键盘触发（click 的 detail 为 0）从中心画。 */
export function attachRipple(host: HTMLElement): () => void {
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !e.isPrimary) return;
    addRipple(host, localPoint(host, e));
  };
  const onClick = (e: MouseEvent): void => {
    if (e.detail === 0) addRipple(host, null);
  };
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("click", onClick);
  return () => {
    host.removeEventListener("pointerdown", onDown);
    host.removeEventListener("click", onClick);
  };
}

export function useRipple(target: Ref<HTMLElement | null>): void {
  let detach: (() => void) | null = null;
  onMounted(() => {
    if (target.value) detach = attachRipple(target.value);
  });
  onBeforeUnmount(() => detach?.());
}

type RippleHost = HTMLElement & { __mRippleOff?: () => void };

/** `v-ripple`：同 useRipple，用在模板里的任意元素上（记得同时加 class="m-fx"）。 */
export const vRipple: Directive<RippleHost> = {
  mounted(el) {
    el.__mRippleOff = attachRipple(el);
  },
  beforeUnmount(el) {
    el.__mRippleOff?.();
  },
};

export interface ManualFXOptions {
  /** 悬停时的缩放（字块 1.05，其余 1） */
  hoverScale?: number;
}

/**
 * 按下特效的「外部驱动」版本，给不是 <button> 的元素（标记芯片：鼠标事件要自己分左 / 右 / 左右同按）用。
 *
 *   const chip = ref<HTMLElement | null>(null);
 *   const fx = useManualFX(chip, { hoverScale: 1.05 });
 *   // 模板：<div ref="chip" class="m-fx m-fx-manual" :class="fx.classes" :style="fx.style" @pointerdown="onDown" ...>
 *   // 自己的 pointerdown 里调 fx.press(e)；pointerup / pointercancel / pointerleave 里调 fx.release()。
 *
 * 悬停状态层与悬停放大由 CSS 负责（:hover）；按下时 `pressed` 为真 → 缩放到 0.95、状态层 16%，并画水波纹。
 */
export function useManualFX(target: Ref<HTMLElement | null>, options: ManualFXOptions = {}) {
  const pressed = ref(false);
  return {
    /** 只读 ref（模板里写 `fx.pressed.value`；`fx` 本身不是响应式对象，嵌套的 ref 不会被自动解包） */
    pressed: readonly(pressed),
    /**
     * 绑到元素的 class：`{ "is-pressed": boolean }`，可在模板里直接 `:class="fx.classes"`。
     * 用 getter 每次渲染时现取 `pressed.value`（会被渲染依赖追踪）——放一个 ref 进对象的话，模板不会解包它，
     * `"is-pressed": ref` 永远为真。
     */
    get classes(): { "is-pressed": boolean } {
      return { "is-pressed": pressed.value };
    },
    /** 绑到元素的 style（悬停缩放） */
    style: { "--m-hover-scale": String(options.hoverScale ?? 1) },
    /** 按下：`e` 是 PointerEvent / MouseEvent（用来定水波纹位置），省略 = 中心 */
    press(e?: { clientX: number; clientY: number }): void {
      pressed.value = true;
      const el = target.value;
      if (el) addRipple(el, e ? localPoint(el, e) : null);
    },
    release(): void {
      pressed.value = false;
    },
  };
}

/** 保证 `release()` 在窗口失焦 / 指针在别处抬起时也能被调用（外部驱动的元素可选用） */
export function releaseOnGlobalPointerUp(release: () => void): () => void {
  const h = (): void => release();
  window.addEventListener("pointerup", h);
  window.addEventListener("pointercancel", h);
  window.addEventListener("blur", h);
  return () => {
    window.removeEventListener("pointerup", h);
    window.removeEventListener("pointercancel", h);
    window.removeEventListener("blur", h);
  };
}
