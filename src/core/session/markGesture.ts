// 把原始鼠标按下 / 抬起事件识别成标记手势（与 DOM 无关，可单元测试）。
// 对应 Swift `Session/MarkGestureRecognizer.swift`。
//
// 手势约定（与桌面一致，并为触控板补了修饰键）：
// - 左键点击 → `primary`；右键 / 双指点按 / Ctrl 点击 → `secondary`；Alt(⌥) + 左键点击 → `secondary`
// - 左右键同按 → `chord`（按下第二个键的瞬间触发）；Shift(⇧) + 左键点击 → `chord`
// - 点击在鼠标抬起时触发（与浏览器 click 一致）
// - 同按触发后，直到所有键都抬起之前，任何抬起都不再当作点击

/** 标记芯片上的一次点按意图。 */
export type MarkGesture =
  /** 左键：对 ↔ 无 */
  | "primary"
  /** 右键 / ⌥ 点击：偏（已是偏则变无） */
  | "secondary"
  /** 左右键同按 / ⇧ 点击：清除为未选 */
  | "chord";

export type MouseButtonKind = "left" | "right";

export interface MarkGestureModifiers {
  /** Alt / ⌥ */
  option?: boolean;
  shift?: boolean;
}

export class MarkGestureRecognizer {
  /** 一旦发生过同按就锁住，等所有键抬起才解开 */
  private chordLatched = false;

  /**
   * 某个键按下。`otherDown` 为另一个键此刻是否已按住。
   * 返回 `chord` 表示这一下构成了左右同按。
   */
  buttonDown(_button: MouseButtonKind, otherDown: boolean): MarkGesture | null {
    if (!otherDown || this.chordLatched) return null;
    this.chordLatched = true;
    return "chord";
  }

  /**
   * 某个键抬起。
   * - `inside`：抬起位置是否仍在芯片内（拖出去再松开不算点击）
   * - `anyStillDown`：抬起之后是否还有鼠标键按着
   */
  buttonUp(
    button: MouseButtonKind,
    inside: boolean,
    modifiers: MarkGestureModifiers,
    anyStillDown: boolean,
  ): MarkGesture | null {
    const latched = this.chordLatched;
    // 所有键都抬起之后才解锁（先取走旧值再解锁，等价于 Swift 的 defer）
    if (!anyStillDown) this.chordLatched = false;
    if (latched || !inside) return null;
    if (button === "right") return "secondary";
    if (modifiers.option) return "secondary";
    if (modifiers.shift) return "chord";
    return "primary";
  }
}
