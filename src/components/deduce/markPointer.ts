// 标记芯片的鼠标手势（= MarkMouseCatcher.swift 的 Pointer Events 版）。
//
// 手势的判定逻辑在 core 的 `MarkGestureRecognizer`（有单元测试），这里只负责把浏览器的指针事件翻译成它要的
// 「某个键按下 / 抬起」：
//   · 左键 = 对 / 无；右键 / 双指点按 / ⌃ 点击（仅 macOS）= 偏；左右同按 = 清除；
//     Alt（macOS 的 ⌥）点击 = 偏、Shift（⇧）点击 = 清除（触控板，各平台通用）
//   · 浏览器的 Pointer Events 只在「第一个键按下 / 最后一个键抬起」时才发 pointerdown / pointerup，
//     中间的第二个键按下 / 抬起是用 pointermove 带着新的 `buttons` 位掩码来通知的——所以每个事件都拿
//     `buttons`（bit0 = 左键，bit1 = 右键）和上一次比，差出来的位就是按下 / 抬起的键（同 Swift 里的 pressedMouseButtons）
//   · 按下时 setPointerCapture：抬起总是落回这个芯片，拖到芯片外再松开由 `inside` 判定为不算点击（同 NSView 的 mouseUp）
//   · 必须 preventDefault 掉原生右键菜单（contextmenu）

import { MarkGestureRecognizer, type MarkGesture, type MouseButtonKind } from "../../core";
import { isMacLike } from "./shortcuts";

const LEFT = 0b01;
const RIGHT = 0b10;

export interface MarkPointerOptions {
  /** 芯片元素（判断抬起位置是否仍在芯片内） */
  element: () => HTMLElement | null;
  /** 识别出一次手势 */
  onGesture: (gesture: MarkGesture) => void;
  /** 第一个键按下（画水波纹 / 按下态） */
  onPress?: (e: PointerEvent) => void;
  /** 所有键抬起或指针被取消（收起按下态） */
  onRelease?: () => void;
}

export interface MarkPointerHandlers {
  onPointerdown(e: PointerEvent): void;
  onPointermove(e: PointerEvent): void;
  onPointerup(e: PointerEvent): void;
  onPointercancel(e: PointerEvent): void;
  onLostpointercapture(e: PointerEvent): void;
  onContextmenu(e: MouseEvent): void;
}

export function createMarkPointer(options: MarkPointerOptions): MarkPointerHandlers {
  let recognizer = new MarkGestureRecognizer();
  /** 上一次看到的按键位掩码（已把 ⌃ 点击折算成右键）；0 = 当前没有键按着 */
  let last = 0;
  /** 这一轮按压是 ⌃ + 左键（macOS 上等同右键），整轮都把左键位当右键 */
  let ctrlAsRight = false;

  const emit = (g: MarkGesture | null): void => {
    if (g !== null) options.onGesture(g);
  };

  /** 事件里的按键位掩码，⌃ 点击折算成右键位 */
  const maskOf = (e: PointerEvent): number => {
    let b = e.buttons & (LEFT | RIGHT);
    if (ctrlAsRight && b & LEFT) b = (b & ~LEFT) | RIGHT;
    return b;
  };

  const kindOf = (bit: number): MouseButtonKind => (bit === RIGHT ? "right" : "left");

  const inside = (e: PointerEvent): boolean => {
    const el = options.element();
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };

  /** 拿新的位掩码和上一次比，把差出来的按下 / 抬起依次喂给识别器 */
  const process = (e: PointerEvent): void => {
    const now = maskOf(e);
    const added = now & ~last;
    const removed = last & ~now;
    let seen = last;
    for (const bit of [LEFT, RIGHT]) {
      if (!(added & bit)) continue;
      const other = bit === LEFT ? RIGHT : LEFT;
      emit(recognizer.buttonDown(kindOf(bit), (seen & other) !== 0));
      seen |= bit;
    }
    // 同一个事件里抬起了多个键时，逐个喂给识别器；「还有键按着」要把还没处理的那几个算进去
    let pending = removed;
    for (const bit of [LEFT, RIGHT]) {
      if (!(removed & bit)) continue;
      pending &= ~bit;
      emit(
        recognizer.buttonUp(kindOf(bit), inside(e), { option: e.altKey, shift: e.shiftKey }, (now | pending) !== 0),
      );
    }
    last = now;
  };

  const reset = (): void => {
    recognizer = new MarkGestureRecognizer();
    last = 0;
    ctrlAsRight = false;
  };

  return {
    onPointerdown(e) {
      // 鼠标的中键 / 侧键不管；触控笔 / 触摸的接触当作左键
      if (e.pointerType === "mouse" && e.button !== 0 && e.button !== 2) return;
      // 上一轮没收到抬起（窗口失焦等）：从头开始
      if (last !== 0) reset();
      // ⌃ 点击当右键只在 macOS 上成立（系统本来就把它当右键）；Windows / Linux 上 Ctrl + 点击就是普通左键
      ctrlAsRight = e.button === 0 && e.ctrlKey && isMacLike();
      try {
        (e.currentTarget as Element | null)?.setPointerCapture?.(e.pointerId);
      } catch {
        // 合成事件没有真实的指针，捕获失败不影响手势
      }
      options.onPress?.(e);
      // 触摸 / 触控笔的 buttons 在按下时就是 1；个别环境 buttons 为 0，按 button 补一位
      const fallback = e.buttons === 0 ? (e.button === 2 || ctrlAsRight ? RIGHT : LEFT) : 0;
      if (fallback) {
        const now = fallback;
        emit(recognizer.buttonDown(kindOf(now), false));
        last = now;
      } else {
        process(e);
      }
    },

    onPointermove(e) {
      // 只关心「按着的状态下 buttons 变了」（左右同按 / 一个键先抬起）
      if (last === 0) return;
      if (maskOf(e) === last) return;
      process(e);
      if (last === 0) options.onRelease?.();
    },

    onPointerup(e) {
      if (last === 0) return;
      // 抬起事件的 buttons 为 0：仍记着的键都在这一刻抬起
      process(e);
      ctrlAsRight = false;
      options.onRelease?.();
    },

    onPointercancel() {
      reset();
      options.onRelease?.();
    },

    onLostpointercapture() {
      // 捕获丢失（元素被移除 / 窗口失焦）：收起按下态；识别器等下一次 pointerdown 时重置
      if (last !== 0) {
        reset();
        options.onRelease?.();
      }
    },

    onContextmenu(e) {
      e.preventDefault();
    },
  };
}
