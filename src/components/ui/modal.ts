// 窗口模态层的行为（MSheet / MDialog 共用）：
//   · 关闭前下面的内容全部点不到、Tab 不到（给 <body> 下其它根节点加 inert，最上层的模态例外）
//   · Esc 关闭（只关最上面一层）
//   · 焦点圈住（Tab / Shift+Tab 在弹层内循环），打开时聚焦到第一个可聚焦元素，关闭后还原焦点
//   · 多层叠加：后打开的在上面，关掉它之后下面那层恢复可用
import { type Ref, onBeforeUnmount, watch } from "vue";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModalEntry {
  id: symbol;
  panel: Ref<HTMLElement | null>;
}

/** 打开着的模态，最后一个是最上层 */
const stack: ModalEntry[] = [];
/** 我们加了 inert 的元素（关掉后只还原这些，别人自己加的不碰） */
const inerted = new Set<Element>();

/**
 * 最上层模态的根节点。必须以 `stack` 为准，不能取 DOM 里最后一个 `.m-modal-root`：
 * 上层模态刚关掉时，它的根节点还留在 DOM 里播离场过渡（约 0.3s），若把它当成「最上层」，
 * 下面那层（如设置弹层）就会被打上 inert，而过渡结束后没人再来刷新，整个弹层从此点不动（表现为卡死）。
 */
function topModalRoot(): Element | undefined {
  for (let i = stack.length - 1; i >= 0; i--) {
    const root = stack[i]!.panel.value?.closest(".m-modal-root");
    if (root) return root;
  }
  const roots = document.querySelectorAll(".m-modal-root");
  return roots[roots.length - 1];
}

function refreshInert(): void {
  const top = topModalRoot();
  // 离场过渡结束后被移出 DOM 的根节点不用再记着
  for (const el of Array.from(inerted)) if (!el.isConnected) inerted.delete(el);
  for (const el of Array.from(document.body.children)) {
    if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
    const shouldInert = stack.length > 0 && el !== top;
    if (shouldInert) {
      if (!el.hasAttribute("inert")) {
        el.setAttribute("inert", "");
        inerted.add(el);
      }
    } else if (inerted.has(el)) {
      el.removeAttribute("inert");
      inerted.delete(el);
    }
  }
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export interface ModalOptions {
  /** 是否打开 */
  open: Ref<boolean>;
  /** 弹层面板（焦点圈在它里面） */
  panel: Ref<HTMLElement | null>;
  /** 按 Esc（且是最上层）时调用；不传 = 不响应 Esc */
  onEscape?: () => void;
}

export function useModal({ open, panel, onEscape }: ModalOptions): void {
  const id = Symbol("modal");
  let previouslyFocused: HTMLElement | null = null;

  const onKeydown = (e: KeyboardEvent): void => {
    if (stack[stack.length - 1]?.id !== id) return;
    if (e.key === "Escape" && onEscape && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      onEscape();
      return;
    }
    if (e.key === "Tab" && panel.value) {
      const items = focusables(panel.value);
      if (items.length === 0) {
        e.preventDefault();
        panel.value.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel.value || !panel.value.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.value.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const activate = (): void => {
    previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    stack.push({ id, panel });
    document.addEventListener("keydown", onKeydown, true);
    // 等面板挂上 DOM 后再处理 inert / 初始焦点
    queueMicrotask(() => {
      refreshInert();
      const p = panel.value;
      if (!p) return;
      const target = p.querySelector<HTMLElement>("[autofocus], [data-autofocus]") ?? focusables(p)[0] ?? p;
      target.focus({ preventScroll: true });
    });
  };

  const deactivate = (): void => {
    document.removeEventListener("keydown", onKeydown, true);
    const i = stack.findIndex((m) => m.id === id);
    if (i >= 0) stack.splice(i, 1);
    queueMicrotask(() => {
      refreshInert();
      if (stack.length === 0 && previouslyFocused?.isConnected) previouslyFocused.focus({ preventScroll: true });
      previouslyFocused = null;
    });
  };

  watch(
    open,
    (isOpen, wasOpen) => {
      if (isOpen && !wasOpen) activate();
      else if (!isOpen && wasOpen) deactivate();
    },
    { immediate: true, flush: "post" },
  );

  onBeforeUnmount(() => {
    if (stack.some((m) => m.id === id)) deactivate();
  });
}
