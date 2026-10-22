// 图标名清单（= App 里用到的全部 SF Symbols 名字）。画法见 Icon.vue。
export const ICON_NAMES = [
  "checkmark",
  "xmark",
  "chevron.up",
  "chevron.down",
  "checkmark.circle.fill",
  "checkmark.square.fill",
  "square",
  "trash",
  "trash.slash",
  "magnifyingglass",
  "text.magnifyingglass",
  "slider.horizontal.3",
  "paintpalette",
  "gearshape",
  "doc.on.doc",
  "arrow.triangle.2.circlepath",
  "arrow.counterclockwise",
] as const;
export type IconName = (typeof ICON_NAMES)[number];
export type IconWeight = "regular" | "medium" | "semibold" | "bold";
