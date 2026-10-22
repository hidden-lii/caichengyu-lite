// useManualFX：classes 必须是模板里能直接用的真值（而不是一个 ref 对象）。
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { useManualFX } from "../../src/components/ui/ripple";

describe("useManualFX", () => {
  it("classes 随按下状态变化，是普通布尔值", () => {
    const fx = useManualFX(ref(null), { hoverScale: 1.05 });
    expect(fx.classes["is-pressed"]).toBe(false);
    fx.press();
    expect(fx.classes["is-pressed"]).toBe(true);
    expect(fx.pressed.value).toBe(true);
    fx.release();
    expect(fx.classes["is-pressed"]).toBe(false);
    expect(fx.pressed.value).toBe(false);
    expect(fx.style["--m-hover-scale"]).toBe("1.05");
  });
});
