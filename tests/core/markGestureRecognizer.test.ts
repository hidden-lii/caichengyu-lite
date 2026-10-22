import { describe, expect, it } from "vitest";
import { MarkGestureRecognizer } from "../../src/core/session/markGesture";

const none = {};

describe("MarkGestureRecognizer", () => {
  it("左键点击", () => {
    const r = new MarkGestureRecognizer();
    expect(r.buttonDown("left", false)).toBeNull();
    expect(r.buttonUp("left", true, none, false)).toBe("primary");
  });

  it("右键点击", () => {
    const r = new MarkGestureRecognizer();
    expect(r.buttonDown("right", false)).toBeNull();
    expect(r.buttonUp("right", true, none, false)).toBe("secondary");
  });

  /** 先按左、再按右：第二个键按下的瞬间触发同按；随后两个键抬起都不再产生点击 */
  it("先左后右同按", () => {
    const r = new MarkGestureRecognizer();
    expect(r.buttonDown("left", false)).toBeNull();
    expect(r.buttonDown("right", true)).toBe("chord");
    expect(r.buttonUp("left", true, none, true)).toBeNull();
    expect(r.buttonUp("right", true, none, false)).toBeNull();
  });

  /** 先按右、再按左，同理 */
  it("先右后左同按", () => {
    const r = new MarkGestureRecognizer();
    expect(r.buttonDown("right", false)).toBeNull();
    expect(r.buttonDown("left", true)).toBe("chord");
    expect(r.buttonUp("right", true, none, true)).toBeNull();
    expect(r.buttonUp("left", true, none, false)).toBeNull();
  });

  /** 同按只触发一次，不会因为反复收到事件而重复清除 */
  it("同按只触发一次", () => {
    const r = new MarkGestureRecognizer();
    r.buttonDown("left", false);
    expect(r.buttonDown("right", true)).toBe("chord");
    expect(r.buttonDown("right", true)).toBeNull();
  });

  /** 所有键抬起后锁解除，下一次普通点击恢复正常 */
  it("所有键抬起后锁解除", () => {
    const r = new MarkGestureRecognizer();
    r.buttonDown("left", false);
    r.buttonDown("right", true);
    r.buttonUp("left", true, none, true);
    r.buttonUp("right", true, none, false);
    r.buttonDown("left", false);
    expect(r.buttonUp("left", true, none, false)).toBe("primary");
  });

  /** 同按后只抬一个键、另一个仍按着时，锁不能提前解除（否则抬起第二个键会被当成点击） */
  it("仍有键按着时锁不解除", () => {
    const r = new MarkGestureRecognizer();
    r.buttonDown("left", false);
    r.buttonDown("right", true);
    expect(r.buttonUp("left", true, none, true)).toBeNull();
    expect(r.buttonUp("right", true, none, false)).toBeNull();
  });

  it("⌥ 点击是偏", () => {
    const r = new MarkGestureRecognizer();
    expect(r.buttonUp("left", true, { option: true }, false)).toBe("secondary");
  });

  it("⇧ 点击是同按", () => {
    const r = new MarkGestureRecognizer();
    expect(r.buttonUp("left", true, { shift: true }, false)).toBe("chord");
  });

  /** 修饰键只影响左键；右键始终是 secondary */
  it("修饰键对右键无效", () => {
    const r = new MarkGestureRecognizer();
    expect(r.buttonUp("right", true, { shift: true }, false)).toBe("secondary");
  });

  it("在芯片外松开不算点击", () => {
    const r = new MarkGestureRecognizer();
    r.buttonDown("left", false);
    expect(r.buttonUp("left", false, none, false)).toBeNull();
  });

  /** 在芯片外松开不应卡住锁：之后的点击仍然有效 */
  it("芯片外松开不会卡住锁", () => {
    const r = new MarkGestureRecognizer();
    r.buttonDown("left", false);
    r.buttonDown("right", true);
    r.buttonUp("left", false, none, true);
    r.buttonUp("right", false, none, false);
    expect(r.buttonUp("left", true, none, false)).toBe("primary");
  });
});
