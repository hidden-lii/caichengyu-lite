import { describe, expect, it } from "vitest";
import { DeduceEngine } from "../../src/core/engine/engine";
import { mergeDeduceConstraints } from "../../src/core/engine/constraints";
import { createPositionMarks, type PolyphoneMap } from "../../src/core/model/types";
import { deduceGuessFromSlots, deduceMark, deduceTestTable, deduceWords } from "./support/engineSupport";

/**
 * 回归：锁字位上的「偏」标记不能被整位丢弃（桌面引擎误杀，见 tools/desktop-patches/README.md）。
 *
 * 机理：桌面 TS/Rust 的第二轮循环用跨猜测、按位置共享的 `charFixed` 跳过声韵调标记。
 * 只要有一条猜测把第 i 位的字标成「对」，其他所有猜测在第 i 位的声韵调标记就都被丢弃。
 * 丢掉「偏」之后，同一条猜测里按 Wordle 重复规则标「无」的同值音素（衣 yi1 的 i 韵，因披 pi1 已占一个 i）
 * 就进了全局排除，把答案里真实存在的 i 韵误杀。
 */
const noPoly: PolyphoneMap = new Map();
const m = deduceMark;

/**
 * 答案「直木先伐」zhi2 mu4 xian1 fa2 的两条真实反馈（按 Wordle 规则逐项推出）：
 * · 夯雀先飞：只有「先」字对（锁住第 3 位）；飞 fei1 的声母 f 与伐 fa2 同位对；雀 que4 的声调 4 与木 mu4 同位对。
 * · 玉女披衣：披 pi1 的韵母 i 偏、声调 1 对；衣 yi1 的韵母 i 因披已占一个而标无。
 */
function guesses() {
  const g1 = deduceGuessFromSlots([
    ["夯", "hang1", m("absent", "absent", "absent", "absent")],
    ["雀", "que4", m("absent", "absent", "absent", "hit")],
    ["先", "xian1", createPositionMarks({ char: "hit", sm: "hit", ym: "hit", tone: "hit", autoSm: true, autoYm: true, autoTone: true })],
    ["飞", "fei1", m("absent", "hit", "absent", "absent")],
  ]);
  const g2 = deduceGuessFromSlots([
    ["玉", "yu4", m("absent", "absent", "present", "present")],
    ["女", "nv3", m("absent", "absent", "absent", "absent")],
    ["披", "pi1", m("absent", "absent", "present", "hit")],
    ["衣", "yi1", m("absent", "absent", "absent", "absent")],
  ]);
  return [g1, g2];
}

describe("DeduceLockedPosition", () => {
  it("锁字位上有「偏」标记时答案不被误杀", () => {
    const table = deduceTestTable([
      ["直木先伐", "zhi2 mu4 xian1 fa2"], // 答案
      ["答木先伐", "da2 mu4 xian1 fa2"], // 没有 i 韵：违反「i 在别处」这条本该生效的偏
    ]);
    const r = DeduceEngine.filter({ table, guesses: guesses(), polyMap: noPoly });
    // 旧行为（按位置跳过）：[答木先伐] —— 答案被误杀，反而留下违反反馈的词
    expect(deduceWords(r)).toEqual(["直木先伐"]);
  });

  /** 同一个问题在合并约束层直接可见：i 韵不能进全局无，且必须作为「偏」约束存在（i 在第 3 位以外）。 */
  it("合并约束层保留锁字位上的韵母偏", () => {
    const merged = mergeDeduceConstraints(guesses());
    expect(merged.absentYm.has("i"), "i 韵被「偏」要求存在，不应进全局无").toBe(false);
    expect(
      merged.present.some((p) => p.kind === "ym" && p.valueStr === "i" && p.notAt === 2),
      "披 pi1 的韵母 i 偏（notAt 第 3 位）应保留为存在约束",
    ).toBe(true);
  });

  /** 修复不改变「本条猜测自己把字标对」的位置：它自己的声韵调标记仍被忽略（字已定，冗余）。 */
  it("本条猜测自己标对的字位，它自己的声韵调标记仍被忽略", () => {
    const table = deduceTestTable([["直木先伐", "zhi2 mu4 xian1 fa2"]]);
    // 先 xian1 字对，但（矛盾地）手动把它的声调标成无；该位属于本条猜测自己的锁字位，应被忽略。
    // 其余位置的反馈与答案一致（雀 que4 的声调 4 与木 mu4 同位对、飞 fei1 的声母 f 与伐 fa2 同位对），
    // 这样答案被排除只可能是「先」的矛盾声调造成的。
    const g = deduceGuessFromSlots([
      ["夯", "hang1", m("absent", "absent", "absent", "absent")],
      ["雀", "que4", m("absent", "absent", "absent", "hit")],
      ["先", "xian1", m("hit", "hit", "hit", "absent")],
      ["飞", "fei1", m("absent", "hit", "absent", "absent")],
    ]);
    const r = DeduceEngine.filter({ table, guesses: [g], polyMap: noPoly });
    expect(deduceWords(r)).toEqual(["直木先伐"]);
  });

  /** 别的猜测在同一锁字位上给出的、与锁字不矛盾的标记，不应改变结果（只是不再被丢弃）。 */
  it("与锁字不矛盾的标记不会缩小答案", () => {
    const table = deduceTestTable([["直木先伐", "zhi2 mu4 xian1 fa2"]]);
    const r = DeduceEngine.filter({ table, guesses: guesses(), polyMap: noPoly });
    expect(deduceWords(r)).toEqual(["直木先伐"]);
  });
});
