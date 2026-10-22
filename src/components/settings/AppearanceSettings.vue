<script setup lang="ts">
// 外观设置（移植自 AppearanceSettingsView.swift）：选主题、自定义主题（颜色 / 圆角 / 阴影 / 样式 / 明暗）、字体（与主题无关）。
// 所有改动立即作用到整个窗口，并自动保存到 appearance.json。文案逐字照抄 Swift。
//
// 宽度填满父级（设置弹层里基础 640，放不下时弹层会自己加宽；快照 / 调试的容器固定 640）；
// 高度由外面决定（设置弹层里填满父级；传 height 则固定，快照 / 调试用）。
import { computed, onMounted, ref } from "vue";
import { Icon, MButton, MDialog, MDisclosure, MColorWell, MPicker, MSelect, MSlider, MSurface, MTextField, MTouch } from "../ui";
import {
  COLOR_GROUPS,
  RADIUS_RANGE,
  SCALE_RANGE,
  SHADOW_RANGE,
  type ChipStyle,
  type ColorKey,
  type FontChoice,
  type MarkStateView,
  type Palette,
  type Scheme,
  type StatusStyle,
  colorFields,
  fontFromTag,
  fontPresets,
  fontStack,
  fontTag,
  installedFontFamilies,
  isBuiltin,
  isDefaultFonts,
  paletteNamed,
  toCss,
  useTheme,
} from "../../theme";

const props = withDefaults(defineProps<{ height?: number; openAllGroups?: boolean }>(), {
  height: undefined,
  openAllGroups: false,
});

const theme = useTheme();

const families = ref<string[]>([]);
const confirmDelete = ref(false);
const openGroups = ref<Record<string, boolean>>(
  Object.fromEntries(COLOR_GROUPS.map((g) => [g.id, props.openAllGroups || g.id === "surface"])),
);

onMounted(async () => {
  families.value = await installedFontFamilies();
});

// MARK: - 预览条

interface Sample {
  ch: string;
  state: MarkStateView;
  auto: boolean;
}
const samples: Sample[] = [
  { ch: "合", state: "hit", auto: false },
  { ch: "作", state: "present", auto: false },
  { ch: "无", state: "absent", auto: false },
  { ch: "间", state: "none", auto: false },
  { ch: "合", state: "hit", auto: true },
  { ch: "作", state: "present", auto: true },
  { ch: "无", state: "absent", auto: true },
];
/** 标记状态 → 背景 / 文字的 CSS 变量（= Theme.nodeColors） */
function sampleStyle(s: Sample): Record<string, string> {
  const v = (n: string): string => `var(--cc-${n})`;
  switch (s.state) {
    case "none":
      return { background: v("node-idle"), color: v("ink") };
    case "hit":
      return s.auto ? { background: v("hit-auto"), color: v("hit-auto-ink") } : { background: v("hit"), color: v("on-mark") };
    case "present":
      return s.auto
        ? { background: v("present-auto"), color: v("present-auto-ink") }
        : { background: v("present"), color: v("on-mark") };
    case "absent":
      return s.auto
        ? { background: v("absent-auto"), color: v("absent-auto-ink") }
        : { background: v("absent"), color: v("on-mark") };
  }
}

// MARK: - 主题列表

function swatches(p: Palette): string[] {
  return [p.bgMid, p.surface, p.accent, p.hit, p.present, p.absent].map(toCss);
}

// MARK: - 自定义主题编辑

const colorGroups = computed(() =>
  COLOR_GROUPS.map((g) => ({
    ...g,
    fields: colorFields.filter((f) => f.group === g.id && !(f.pillOnly && theme.palette.statusStyle === "plain")),
  })),
);

const baseTheme = computed(() => paletteNamed(theme.palette.baseID ?? ""));

function setColor(key: ColorKey, c: Palette[ColorKey]): void {
  theme.updateCurrentCustom((p) => void (p[key] = c));
}
type RadiusKey = "cardRadius" | "chipRadius" | "fieldRadius";
function setRadius(key: RadiusKey, v: number): void {
  theme.updateCurrentCustom((p) => void (p[key] = v));
}
function setShadow(v: number): void {
  theme.updateCurrentCustom((p) => void (p.shadowOpacity = v));
}
function setName(v: string): void {
  theme.updateCurrentCustom((p) => void (p.name = v));
}
function setCapsule(v: boolean): void {
  theme.updateCurrentCustom((p) => void (p.capsuleButtons = v));
}
function setChipStyle(v: ChipStyle): void {
  theme.updateCurrentCustom((p) => void (p.chipStyle = v));
}
function setStatusStyle(v: StatusStyle): void {
  theme.updateCurrentCustom((p) => void (p.statusStyle = v));
}
function setScheme(v: Scheme): void {
  theme.updateCurrentCustom((p) => void (p.scheme = v));
}

const ptLabel = (v: number): string => `${Math.trunc(v)} pt`;
const shadowLabel = (v: number): string => (v < 0.005 ? "无" : `${Math.round(v * 100)}%`);
const percentLabel = (v: number): string => `${Math.round(v * 100)}%`;

// MARK: - 字体

function fontModel(choice: FontChoice): string {
  return fontTag(choice);
}
function fontMissing(choice: FontChoice): boolean {
  return choice.kind === "family" && families.value.length > 0 && !families.value.includes(choice.family ?? "");
}
/** 当前选中的字体族不在已安装列表里（还没加载好 / 已卸载）时，补一项，免得下拉显示空白 */
function extraFamilyOption(choice: FontChoice): { tag: string; label: string } | null {
  if (choice.kind !== "family" || !choice.family) return null;
  if (fontMissing(choice)) return { tag: fontTag(choice), label: `${choice.family}（未安装）` };
  if (families.value.length === 0) return { tag: fontTag(choice), label: choice.family };
  return null;
}
function setFont(which: "ui" | "word", tag: string): void {
  const c = fontFromTag(tag);
  if (!c) return;
  if (which === "ui") theme.setUiFont(c);
  else theme.setWordFont(c);
}
const fontSample = (c: FontChoice): Record<string, string> => ({
  fontFamily: fontStack(c),
  fontSize: `calc(16px * ${theme.fonts.scale})`,
});

const canResetFonts = computed(() => !isDefaultFonts(theme.fonts));
</script>

<template>
  <div class="ap" :style="height !== undefined ? { height: `${height}px` } : undefined">
    <!-- 预览（固定在顶部，改什么都能立刻看到） -->
    <div class="ap-preview-wrap">
      <MSurface card class="ap-preview">
        <span class="ap-preview__title">合作无间</span>
        <span class="ap-preview__chips">
          <span
            v-for="(s, i) in samples"
            :key="i"
            class="ap-sample"
            :class="{ 'is-outlined': theme.palette.chipStyle === 'solidOutlined' }"
            :style="sampleStyle(s)"
            >{{ s.ch }}</span
          >
        </span>
        <span class="ap-preview__spacer" />
        <span class="ap-preview__buttons">
          <MButton kind="filled" compact>确认</MButton>
          <MButton kind="text" compact>取消选择</MButton>
          <MButton kind="textDanger" compact>删除</MButton>
        </span>
      </MSurface>
    </div>
    <hr class="ap-divider" />

    <div class="ap-scroll">
      <div class="ap-content">
        <!-- 主题 -->
        <section class="ap-section">
          <div class="ap-row-between">
            <h3 class="ap-title">主题</h3>
            <MButton
              kind="text"
              compact
              title="以当前主题为底复制一份，可以改颜色、圆角、阴影等"
              @click="theme.duplicateCurrent()"
            >
              新建自定义主题
            </MButton>
          </div>
          <div class="ap-grid">
            <MTouch v-for="p in theme.allThemes" :key="p.id" block :radius="10" tint="var(--cc-ink)" :press-scale="0.98" @click="theme.select(p.id)">
              <div class="ap-card" :class="{ 'is-selected': p.id === theme.selectedID }">
                <div class="ap-swatches">
                  <span v-for="(c, i) in swatches(p)" :key="i" :style="{ background: c }" />
                </div>
                <div class="ap-card__name">
                  <span class="ap-card__title">{{ p.name === "" ? "未命名" : p.name }}</span>
                  <span v-if="!isBuiltin(p)" class="ap-card__tag">自定义</span>
                  <span class="ap-card__spacer" />
                  <Icon v-if="p.id === theme.selectedID" class="ap-card__check" name="checkmark.circle.fill" />
                </div>
                <div class="ap-card__tagline">{{ p.tagline }}</div>
              </div>
            </MTouch>
          </div>
        </section>

        <!-- 自定义主题编辑器 / 只读提示 -->
        <section v-if="theme.selectedIsCustom" class="ap-editor">
          <div class="ap-editor__head">
            <h3 class="ap-title">编辑自定义主题</h3>
            <span class="ap-note ap-note--12">改动立即生效、自动保存</span>
          </div>

          <div class="ap-name-row">
            <span class="ap-label ap-label--70">名称</span>
            <MTextField
              class="ap-name-field"
              :model-value="theme.palette.name"
              placeholder="给主题起个名字"
              @update:model-value="setName"
            />
          </div>

          <MDisclosure v-for="g in colorGroups" :key="g.id" v-model="openGroups[g.id]" :title="g.title">
            <div class="ap-colors">
              <div v-for="f in g.fields" :key="f.key" class="ap-color">
                <MColorWell
                  :model-value="theme.palette[f.key]"
                  :label="f.label"
                  @update:model-value="(c) => setColor(f.key, c)"
                />
                <span class="ap-color__label">{{ f.label }}</span>
              </div>
            </div>
          </MDisclosure>

          <hr class="ap-divider ap-divider--inset" />
          <h3 class="ap-title ap-title--small">形状与样式</h3>
          <div class="ap-shape">
            <div class="ap-field-row">
              <span class="ap-label ap-label--140">卡片圆角</span>
              <MSlider :model-value="theme.palette.cardRadius" :min="RADIUS_RANGE.min" :max="RADIUS_RANGE.max" :step="1" label="卡片圆角" @update:model-value="(v) => setRadius('cardRadius', v)" />
              <span class="ap-value">{{ ptLabel(theme.palette.cardRadius) }}</span>
            </div>
            <div class="ap-field-row">
              <span class="ap-label ap-label--140">标记块圆角</span>
              <MSlider :model-value="theme.palette.chipRadius" :min="RADIUS_RANGE.min" :max="RADIUS_RANGE.max" :step="1" label="标记块圆角" @update:model-value="(v) => setRadius('chipRadius', v)" />
              <span class="ap-value">{{ ptLabel(theme.palette.chipRadius) }}</span>
            </div>
            <div class="ap-field-row">
              <span class="ap-label ap-label--140">按钮 / 输入框圆角</span>
              <MSlider :model-value="theme.palette.fieldRadius" :min="RADIUS_RANGE.min" :max="RADIUS_RANGE.max" :step="1" label="按钮 / 输入框圆角" @update:model-value="(v) => setRadius('fieldRadius', v)" />
              <span class="ap-value">{{ ptLabel(theme.palette.fieldRadius) }}</span>
            </div>
            <div class="ap-field-row">
              <span class="ap-label ap-label--140">卡片阴影</span>
              <MSlider :model-value="theme.palette.shadowOpacity" :min="SHADOW_RANGE.min" :max="SHADOW_RANGE.max" :step="0.01" label="卡片阴影" @update:model-value="setShadow" />
              <span class="ap-value">{{ shadowLabel(theme.palette.shadowOpacity) }}</span>
            </div>
            <div class="ap-field-row">
              <span class="ap-label ap-label--140">按钮形状</span>
              <MPicker
                :width="200"
                label="按钮形状"
                :options="[{ value: false, label: '圆角矩形' }, { value: true, label: '胶囊' }]"
                :model-value="theme.palette.capsuleButtons"
                @update:model-value="setCapsule"
              />
            </div>
            <div class="ap-field-row">
              <span class="ap-label ap-label--140">标记块</span>
              <MPicker
                :width="200"
                label="标记块"
                :options="[{ value: 'solid', label: '纯色' }, { value: 'solidOutlined', label: '纯色 + 描边' }]"
                :model-value="theme.palette.chipStyle"
                @update:model-value="setChipStyle"
              />
            </div>
            <div class="ap-field-row">
              <span class="ap-label ap-label--140">词库状态条</span>
              <MPicker
                :width="200"
                label="词库状态条"
                :options="[{ value: 'pill', label: '色块' }, { value: 'plain', label: '小圆点 + 文字' }]"
                :model-value="theme.palette.statusStyle"
                @update:model-value="setStatusStyle"
              />
            </div>
            <div class="ap-scheme">
              <div class="ap-field-row">
                <span class="ap-label ap-label--140">系统控件明暗</span>
                <MPicker
                  :width="200"
                  label="系统控件明暗"
                  :options="[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]"
                  :model-value="theme.palette.scheme"
                  @update:model-value="setScheme"
                />
              </div>
              <p class="ap-note ap-note--11 ap-scheme__note">
                决定输入框光标、滚动条、弹窗等系统控件用浅色还是深色。深色底的主题请选深色。
              </p>
            </div>
          </div>

          <div class="ap-row-between ap-editor__foot">
            <MButton
              v-if="baseTheme"
              kind="text"
              compact
              title="颜色与样式全部还原，名称保留"
              @click="theme.resetCurrentCustomToBase()"
            >
              恢复为「{{ baseTheme.name }}」的样子
            </MButton>
            <span v-else />
            <MButton kind="textDanger" compact @click="confirmDelete = true">删除这个主题</MButton>
          </div>
        </section>
        <p v-else class="ap-note ap-note--12">
          内置主题不能直接修改。想调颜色、圆角等，先点上面的「新建自定义主题」，它会以当前主题为底复制一份供你修改。
        </p>

        <hr class="ap-divider ap-divider--inset" />

        <!-- 字体 -->
        <section class="ap-section">
          <h3 class="ap-title">字体</h3>
          <p class="ap-note ap-note--12">字体与主题无关：换主题不会改变字体。默认沿用桌面版的宋体。</p>

          <div v-for="row in [{ key: 'ui', label: '界面文字' }, { key: 'word', label: '成语字头' }] as const" :key="row.key" class="ap-field-row">
            <span class="ap-label ap-label--140">{{ row.label }}</span>
            <MSelect
              :width="230"
              :label="row.label"
              :model-value="fontModel(theme.fonts[row.key])"
              @update:model-value="(t) => setFont(row.key, t)"
            >
              <option v-for="p in fontPresets" :key="p.label" :value="fontTag(p.choice)">{{ p.label }}</option>
              <option v-if="extraFamilyOption(theme.fonts[row.key])" :value="extraFamilyOption(theme.fonts[row.key])!.tag">
                {{ extraFamilyOption(theme.fonts[row.key])!.label }}
              </option>
              <optgroup label="系统已安装的字体">
                <option v-for="name in families" :key="name" :value="`family:${name}`">{{ name }}</option>
              </optgroup>
            </MSelect>
            <span class="ap-font-sample" :style="fontSample(theme.fonts[row.key])">合作无间 Aa 12</span>
          </div>

          <div class="ap-field-row">
            <span class="ap-label ap-label--140">整体字号</span>
            <MSlider :model-value="theme.fonts.scale" :min="SCALE_RANGE.min" :max="SCALE_RANGE.max" :step="0.05" label="整体字号" @update:model-value="(v) => theme.setFontScale(v)" />
            <span class="ap-value">{{ percentLabel(theme.fonts.scale) }}</span>
          </div>

          <div class="ap-fonts-foot">
            <MButton kind="text" compact :disabled="!canResetFonts" @click="theme.resetFonts()">恢复默认字体</MButton>
            <span class="ap-note ap-note--11">字号放得太大时，候选卡片和标记台会变挤，建议不超过 115%。</span>
          </div>
        </section>

        <p v-if="theme.loadNote" class="ap-warn">{{ theme.loadNote }}</p>
      </div>
    </div>

    <MDialog
      v-model="confirmDelete"
      :title="`删除主题「${theme.palette.name}」？`"
      message="删除后会回到桌面版主题，且无法恢复。"
      confirm-text="删除"
      cancel-text="取消"
      destructive
      @confirm="theme.deleteCustom(theme.selectedID)"
    />
  </div>
</template>

<style scoped>
.ap {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--cc-bg);
  color: var(--cc-ink);
}

/* —— 预览条 —— */
.ap-preview-wrap {
  flex: none;
  padding: 12px 20px;
  background: var(--cc-bg-gradient);
}
.ap-preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  column-gap: 12px;
  row-gap: 8px;
  padding: 12px 14px;
}
.ap-preview__title {
  letter-spacing: 0; /* 字头（宋体 / 楷体）在基准里是满宽，不收字距 */
  font-family: var(--cc-font-word);
  font-size: calc(19px * var(--cc-font-scale));
  font-weight: 600;
  white-space: nowrap;
}
.ap-preview__chips {
  display: inline-flex;
  gap: 4px;
}
.ap-preview__spacer {
  flex: 1 1 0;
  min-width: 0;
}
.ap-preview__buttons {
  display: inline-flex;
  gap: 8px;
}
.ap-sample {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--cc-chip-radius);
  letter-spacing: 0;
  font-family: var(--cc-font-word);
  font-size: calc(15px * var(--cc-font-scale));
  font-weight: 600;
  line-height: 1;
}
.ap-sample.is-outlined {
  box-shadow:
    inset 0 0 0 0.5px var(--cc-chip-outline),
    0 0 0 0.5px var(--cc-chip-outline);
}

/* —— Divider —— */
.ap-divider {
  flex: none;
  height: 1px;
  margin: 0;
  border: 0;
  background: color-mix(in srgb, var(--cc-ink) 14%, transparent);
}
.ap-divider--inset {
  width: 100%;
}

/* —— 滚动区 —— */
.ap-scroll {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}
.ap-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px;
}
.ap-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ap-row-between {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.ap-title {
  margin: 0;
  font-family: var(--cc-font-ui);
  font-size: calc(18px * var(--cc-font-scale));
  font-weight: 600;
  line-height: var(--cc-cjk-lh, normal);
}
.ap-title--small {
  font-size: calc(14px * var(--cc-font-scale));
}
.ap-note {
  margin: 0;
  font-family: var(--cc-font-ui);
  color: var(--cc-muted);
}
.ap-note--12 {
  font-size: calc(12.5px * var(--cc-font-scale));
}
.ap-editor__head .ap-note--12 {
  font-size: calc(12px * var(--cc-font-scale));
  /* 与标题基线对齐的单行注释：行高别撑高这一行 */
  line-height: var(--cc-cjk-lh, normal);
}
.ap-note--11 {
  font-size: calc(11.5px * var(--cc-font-scale));
}
.ap-warn {
  margin: 0;
  font-family: var(--cc-font-ui);
  font-size: calc(12.5px * var(--cc-font-scale));
  color: var(--cc-warn);
}

/* —— 主题卡片 —— */
.ap-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}
.ap-card {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 10px;
  border-radius: 10px;
  background: var(--cc-surface);
  text-align: left;
  /* 1pt 描边，居中于边缘（SwiftUI 的 stroke） */
  box-shadow:
    0 0 0 0.5px var(--cc-border),
    inset 0 0 0 0.5px var(--cc-border);
}
.ap-card.is-selected {
  box-shadow:
    0 0 0 1px var(--cc-accent),
    inset 0 0 0 1px var(--cc-accent);
}
.ap-swatches {
  position: relative;
  display: flex;
  height: 20px;
  border-radius: 5px;
  overflow: hidden;
}
.ap-swatches > span {
  flex: 1 1 0;
}
/* 1pt 描边（Color.primary 15%）居中于边缘：一半在色块里（::after），一半在色块外（本体的 box-shadow，不被 overflow 裁掉） */
.ap-swatches {
  box-shadow: 0 0 0 0.5px rgb(0 0 0 / 0.15);
}
.ap-swatches::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 0.15);
}
:root[data-scheme="dark"] .ap-swatches {
  box-shadow: 0 0 0 0.5px rgb(255 255 255 / 0.15);
}
:root[data-scheme="dark"] .ap-swatches::after {
  box-shadow: inset 0 0 0 0.5px rgb(255 255 255 / 0.15);
}
.ap-card__name {
  display: flex;
  align-items: center;
  gap: 6px;
}
/* SwiftUI 中文系统字体的行高：14pt → 17、11.5pt → 13（基准图实测），Chrome 的 normal 偏高 3~7px */
.ap-card__title {
  font-family: var(--cc-font-ui);
  font-size: calc(14px * var(--cc-font-scale));
  font-weight: 600;
  line-height: calc(17 / 14);
  /* SwiftUI 的行高是整点：16.1pt（字号放大 1.15 倍）→ 19，向下取整 */
  line-height: round(down, calc(17em / 14), 1px);
}
.ap-card__tag {
  padding: 1px 5px;
  border-radius: 1000px;
  background: var(--cc-accent-soft);
  color: var(--cc-accent);
  font-family: var(--cc-font-ui);
  font-size: calc(10.5px * var(--cc-font-scale));
  line-height: calc(13 / 10.5);
  line-height: round(up, calc(13em / 10.5), 1px);
}
.ap-card__spacer {
  flex: 1 1 0;
  min-width: 0;
}
.ap-card__check {
  font-size: 13px;
  color: var(--cc-accent);
}
.ap-card__tagline {
  min-height: 2lh;
  font-family: var(--cc-font-ui);
  font-size: calc(11.5px * var(--cc-font-scale));
  line-height: calc(13 / 11.5);
  line-height: round(up, calc(13em / 11.5), 1px);
  color: var(--cc-muted);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

/* —— 编辑器 —— */
.ap-editor {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.ap-editor__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.ap-name-row,
.ap-field-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.ap-label {
  flex: none;
  text-align: right;
  font-family: var(--cc-font-ui);
  font-size: calc(13.5px * var(--cc-font-scale));
  line-height: var(--cc-cjk-lh, normal);
}
.ap-label--70 {
  width: 70px;
}
.ap-label--140 {
  width: 140px;
}
.ap-name-field {
  max-width: 260px;
  line-height: var(--cc-field-lh, 1.3);
}
.ap-colors {
  display: grid;
  grid-template-columns: 1fr 1fr;
  column-gap: 16px;
  row-gap: 8px;
}
.ap-color {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.ap-color__label {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-family: var(--cc-font-ui);
  font-size: calc(13px * var(--cc-font-scale));
  line-height: var(--cc-cjk-lh, normal);
}
.ap-shape {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ap-value {
  flex: none;
  width: 44px;
  font-family: var(--cc-font-mono);
  font-size: calc(11.5px * var(--cc-font-scale));
  font-weight: 400;
  color: var(--cc-muted);
}
.ap-scheme {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.ap-scheme__note {
  padding-left: 148px;
}
.ap-editor__foot {
  margin-top: 0;
}
.ap-font-sample {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}
.ap-fonts-foot {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
