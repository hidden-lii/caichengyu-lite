<script lang="ts">
// 图标：自己手写的 SVG，对着 mac 版截图里 SF Symbols 的形状与描边粗细画成相近的样子（不使用 Apple 的字形轮廓）。
//
// 约定：
// · 跟随文字：宽高 1em（占位和 SwiftUI 的 `Image(systemName:)` 一致，字号由外层 `font-size` 决定），颜色 = currentColor。
// · 图稿画在 24×24 的坐标里，只显示中间 20×20（viewBox="2 2 20 20"），超出的部分照样画（overflow: visible）：
//   SF Symbols 的字形比 1em 大一圈（垃圾桶高 ≈ 1.07em，调色盘宽 ≈ 1.2em），这样同样的 font-size 下大小才对得上。
// · weight 对应 SwiftUI 的 `.font(.system(size:, weight:))`：regular / medium / semibold / bold，决定描边粗细。
//
// 现有图标（App 里用到的全部 SF Symbols）：
//   checkmark  xmark  chevron.up  chevron.down  checkmark.circle.fill  checkmark.square.fill  square
//   trash  trash.slash  magnifyingglass  text.magnifyingglass  slider.horizontal.3  paintpalette  gearshape
//   doc.on.doc  arrow.triangle.2.circlepath  arrow.counterclockwise
import { type VNode, defineComponent, h, useId, type PropType } from "vue";
import type { IconName, IconWeight } from "./iconNames";

const STROKE: Record<IconWeight, number> = { regular: 1.5, medium: 1.8, semibold: 2.1, bold: 2.5 };

const f = (n: number): string => String(Math.round(n * 100) / 100);
const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

/** 八齿齿轮的外轮廓（梯形齿 + 窄 V 形谷） */
function gearPath(): string {
  const cx = 12;
  const cy = 12;
  const rOuter = 9.6;
  const rRoot = 7.4;
  const halfTop = 11;
  const halfRoot = 17;
  let d = "";
  for (let i = 0; i < 8; i++) {
    const a = -90 + i * 45;
    const p1 = polar(cx, cy, rRoot, a - halfRoot);
    const p2 = polar(cx, cy, rOuter, a - halfTop);
    const p3 = polar(cx, cy, rOuter, a + halfTop);
    const p4 = polar(cx, cy, rRoot, a + halfRoot);
    d += `${i === 0 ? "M" : "L"}${f(p1[0])} ${f(p1[1])}L${f(p2[0])} ${f(p2[1])}L${f(p3[0])} ${f(p3[1])}L${f(p4[0])} ${f(p4[1])}`;
    const next = polar(cx, cy, rRoot, a + 45 - halfRoot);
    d += `A${rRoot} ${rRoot} 0 0 1 ${f(next[0])} ${f(next[1])}`;
  }
  return d + "Z";
}
const GEAR = gearPath();

type Part = VNode;
const path = (d: string, extra: Record<string, unknown> = {}): Part => h("path", { d, ...extra });
const circle = (cx: number, cy: number, r: number, extra: Record<string, unknown> = {}): Part =>
  h("circle", { cx, cy, r, ...extra });
const FILL = { fill: "currentColor", stroke: "none" };

/** 放大镜的圆环 + 手柄（magnifyingglass / text.magnifyingglass 共用） */
const glass = (): Part[] => [circle(10.8, 10.6, 7.2), path("M16.2 16 L21.4 21.3")];

export default defineComponent({
  name: "Icon",
  props: {
    name: { type: String as PropType<IconName>, required: true },
    weight: { type: String as PropType<IconWeight>, default: "regular" },
    /** 不传 = 1em（跟随字号）；传数字按 px */
    size: { type: [Number, String] as PropType<number | string>, default: undefined },
  },
  setup(props) {
    const uid = useId();
    return () => {
      const sw = STROKE[props.weight];
      let parts: Part[];
      let wide = false;
      switch (props.name) {
        case "checkmark":
          parts = [path("M4.6 12.9 L9.1 17.4 L19.6 5.8")];
          break;
        case "xmark":
          // 基准里 14pt 的 ✕ 墨迹约 11px 见方
          parts = [path("M5.2 5.2 L18.8 18.8 M18.8 5.2 L5.2 18.8")];
          break;
        case "chevron.up":
          parts = [path("M3.6 16.4 L12 8 L20.4 16.4")];
          break;
        case "chevron.down":
          parts = [path("M3.6 8 L12 16.4 L20.4 8")];
          break;
        case "checkmark.circle.fill":
          // 实心圆 + 镂空对勾
          parts = [
            h("mask", { id: `${uid}-m` }, [
              h("rect", { x: -4, y: -4, width: 32, height: 32, fill: "#fff", stroke: "none" }),
              path("M7.7 12.4 L10.7 15.4 L16.6 8.9", { stroke: "#000", "stroke-width": 2.2 }),
            ]),
            circle(12, 12, 9.8, { ...FILL, mask: `url(#${uid}-m)` }),
          ];
          break;
        case "checkmark.square.fill":
          parts = [
            h("mask", { id: `${uid}-m` }, [
              h("rect", { x: -4, y: -4, width: 32, height: 32, fill: "#fff", stroke: "none" }),
              path("M7.2 12.3 L10.6 15.7 L17 8.4", { stroke: "#000", "stroke-width": 2.3 }),
            ]),
            h("rect", { x: 2.4, y: 2.4, width: 19.2, height: 19.2, rx: 4.4, ...FILL, mask: `url(#${uid}-m)` }),
          ];
          break;
        case "square":
          parts = [h("rect", { x: 3.2, y: 3.2, width: 17.6, height: 17.6, rx: 4 })];
          break;
        case "trash":
          parts = [
            path("M2.6 6.4 H21.4"),
            path("M8.6 6.4 V4.9 A1.7 1.7 0 0 1 10.3 3.2 H13.7 A1.7 1.7 0 0 1 15.4 4.9 V6.4"),
            path("M4.7 6.4 L5.7 19.8 A2 2 0 0 0 7.7 21.6 H16.3 A2 2 0 0 0 18.3 19.8 L19.3 6.4"),
            path("M9.4 10.4 V17.6 M12 10.4 V17.6 M14.6 10.4 V17.6", { "stroke-width": sw * 0.85 }),
          ];
          break;
        case "trash.slash":
          parts = [
            h("mask", { id: `${uid}-m` }, [
              h("rect", { x: -4, y: -4, width: 32, height: 32, fill: "#fff", stroke: "none" }),
              path("M2.2 1.8 L22.2 21.8", { stroke: "#000", "stroke-width": sw * 2.6 }),
            ]),
            h("g", { mask: `url(#${uid}-m)` }, [
              path("M2.6 6.4 H21.4"),
              path("M8.6 6.4 V4.9 A1.7 1.7 0 0 1 10.3 3.2 H13.7 A1.7 1.7 0 0 1 15.4 4.9 V6.4"),
              path("M4.7 6.4 L5.7 19.8 A2 2 0 0 0 7.7 21.6 H16.3 A2 2 0 0 0 18.3 19.8 L19.3 6.4"),
              path("M9.4 10.4 V17.6 M12 10.4 V17.6 M14.6 10.4 V17.6", { "stroke-width": sw * 0.85 }),
            ]),
            path("M2.4 2 L21.8 21.4"),
          ];
          break;
        case "magnifyingglass":
          parts = glass();
          break;
        case "text.magnifyingglass":
          parts = [...glass(), path("M7.4 10.2 H14.3 M7.4 12.9 H12.6", { "stroke-width": sw * 1.1 })];
          break;
        case "slider.horizontal.3": {
          // 基准（14pt）里墨迹约 14 × 12px：三根线，上下两个滑块靠右、中间一个靠左；图标自己占 1.2em 宽（SF Symbol 左右各留 1.5px 的空）
          const knob = (cx: number, cy: number): Part => h("rect", { x: cx - 2.7, y: cy - 2.2, width: 5.4, height: 4.4, rx: 2.2 });
          parts = [
            path("M3 6.6 H11.9 M18.5 6.6 H21"),
            knob(15.2, 6.6),
            path("M3 12 H4.9 M11.5 12 H21"),
            knob(8.2, 12),
            path("M3 17.4 H11.9 M18.5 17.4 H21"),
            knob(15.2, 17.4),
          ];
          wide = true;
          break;
        }
        case "paintpalette":
          parts = [
            path(
              "M12 2.2 C5.8 2.2 0.7 6.7 0.7 12.3 C0.7 18 5.5 22 11.4 21.9 C13.3 21.9 14.4 20.8 14.4 19.3 C14.4 17.8 13.2 17.2 13.2 15.9 C13.2 14.6 14.3 13.6 15.8 13.6 L19.6 13.6 C22.3 13.6 24 11.9 24 9.5 C24 5.3 18.8 2.2 12 2.2 Z",
            ),
            circle(11.2, 16.2, 1.45),
            circle(7.8, 9.9, 1.9, FILL),
            circle(12.4, 8.5, 1.5, FILL),
            circle(17, 9.7, 1.15, FILL),
            circle(3.9, 13, 1.5, FILL),
          ];
          break;
        case "gearshape":
          parts = [path(GEAR), circle(12, 12, 3.4)];
          break;
        case "doc.on.doc":
          parts = [
            // 后面那张（只露出右上）
            path("M7.6 6.5 V4.6 A2.4 2.4 0 0 1 10 2.2 H15.4 L22 8.8 V15.6 A2.4 2.4 0 0 1 19.6 18 H17.2"),
            path("M15.4 2.2 V6.4 A2.4 2.4 0 0 0 17.8 8.8 H22"),
            // 前面那张（右上折角）
            path("M2 9.3 A2.6 2.6 0 0 1 4.6 6.7 H10.4 L16.2 12.5 V19.4 A2.6 2.6 0 0 1 13.6 22 H4.6 A2.6 2.6 0 0 1 2 19.4 Z"),
            path("M10.4 6.7 V10.1 A2.4 2.4 0 0 0 12.8 12.5 H16.2"),
          ];
          break;
        case "arrow.triangle.2.circlepath":
          parts = [
            path("M4.4 11.2 A7.9 7.9 0 0 1 17.3 6.1"),
            path("M19.6 12.8 A7.9 7.9 0 0 1 6.7 17.9"),
            path("M18.4 2.6 L19.6 8.6 L13.8 7.6 Z", { ...FILL, "stroke-width": 0.6, stroke: "currentColor" }),
            path("M5.6 21.4 L4.4 15.4 L10.2 16.4 Z", { ...FILL, "stroke-width": 0.6, stroke: "currentColor" }),
          ];
          break;
        case "arrow.counterclockwise":
          parts = [
            path("M3.6 12.6 A8.4 8.4 0 1 0 8.9 5.6"),
            path("M13.3 2.4 L8.7 5.7 L12.8 9.6"),
          ];
          break;
      }
      return h(
        "svg",
        {
          class: "m-icon",
          viewBox: wide ? "0 2 24 20" : "2 2 20 20",
          width: props.size === undefined ? (wide ? "1.2em" : "1em") : wide ? `calc(${typeof props.size === "number" ? `${props.size}px` : props.size} * 1.2)` : props.size,
          height: props.size === undefined ? "1em" : props.size,
          fill: "none",
          stroke: "currentColor",
          "stroke-width": sw,
          "stroke-linecap": "round",
          "stroke-linejoin": "round",
          "aria-hidden": "true",
          focusable: "false",
          style: "overflow: visible; flex: none; display: inline-block; vertical-align: middle;",
        },
        parts,
      );
    };
  },
});
</script>
