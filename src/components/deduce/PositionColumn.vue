<script setup lang="ts">
// 「详细」弹层里的一个字位列（= DetailSheet.swift 的 PositionColumn）：逐部件精确设置 对 / 偏 / 无，改声调，设声韵组合。
import { computed } from "vue";
import { toneDigit, toneLabel, type CharData, type DeduceSession, type MarkAttr, type MarkState, type PositionMarks } from "../../core";
import { MSelect, MTouch } from "../ui";
import { markTint, nodeColors } from "./markColors";

const props = defineProps<{ session: DeduceSession; pos: number; ch: CharData; marks: PositionMarks }>();

interface Row {
  label: string;
  attr: MarkAttr;
  value: string;
  auto: boolean;
  state: MarkState | null;
}

const rows = computed<Row[]>(() => {
  const { ch, marks } = props;
  return [
    { label: "字", attr: "char", value: ch.c, auto: false, state: marks.char },
    { label: "声母", attr: "sm", value: ch.sm.length === 0 ? "零" : ch.sm, auto: marks.autoSm, state: marks.sm },
    { label: "韵母", attr: "ym", value: ch.ym.length === 0 ? "—" : ch.ym, auto: marks.autoYm, state: marks.ym },
    { label: "声调", attr: "tone", value: toneLabel(ch.tone), auto: marks.autoTone, state: marks.tone },
  ];
});

const MARK_BUTTONS: { title: string; mark: MarkState }[] = [
  { title: "对", mark: "hit" },
  { title: "偏", mark: "present" },
  { title: "无", mark: "absent" },
];

const comboColors = computed(() => nodeColors(props.marks.combo, false));
const comboLabel = computed(() => props.ch.sm + props.ch.ym + (props.marks.comboTone ? toneDigit(props.ch.tone) : ""));
const COMBO_BUTTONS = [
  { title: "组", kind: "combo", tint: markTint("present") },
  { title: "组调", kind: "comboTone", tint: markTint("present") },
  { title: "无", kind: "absent", tint: markTint("absent") },
] as const;

function comboActive(kind: (typeof COMBO_BUTTONS)[number]["kind"]): boolean {
  const m = props.marks;
  switch (kind) {
    case "combo":
      return m.combo === "present" && !m.comboTone;
    case "comboTone":
      return m.combo === "present" && m.comboTone;
    case "absent":
      return m.combo === "absent";
  }
}

const colorsOf = (row: Row) => nodeColors(row.state, row.auto);
const isActive = (row: Row, mark: MarkState): boolean => row.state === mark && (row.attr === "char" || !row.auto);
</script>

<template>
  <div class="dd-pos">
    <div class="dd-pos__title">第 {{ pos + 1 }} 字 · {{ ch.py }}{{ toneDigit(ch.tone) }}</div>

    <div v-for="row in rows" :key="row.attr" class="dd-attr">
      <div class="dd-attr__label">
        {{ row.label }}
        <span v-if="row.auto" class="dd-attr__auto">自动</span>
      </div>
      <div
        class="dd-attr__value"
        :class="{ 'is-char': row.attr === 'char' }"
        :style="{ '--chip-bg': colorsOf(row).bg, '--chip-fg': colorsOf(row).fg }"
      >
        {{ row.value }}
      </div>

      <MSelect
        v-if="row.attr === 'tone'"
        class="dd-attr__tone"
        :model-value="String(ch.tone)"
        :width="50"
        label="声调"
        @update:model-value="(v: string) => session.setDraftTone(pos, Number(v))"
      >
        <option v-for="t in [1, 2, 3, 4, 5]" :key="t" :value="String(t)">{{ t === 5 ? "轻" : t }}</option>
      </MSelect>

      <div v-if="row.auto" class="dd-attr__note">随字自动（浅色）；点下方按钮可改为人选</div>

      <div class="dd-attr__btns">
        <MTouch
          v-for="b in MARK_BUTTONS"
          :key="b.mark"
          class="dd-attr__btn"
          :class="{ 'is-active': isActive(row, b.mark) }"
          :style="{ '--btn-tint': markTint(b.mark) }"
          :radius="8"
          :tint="isActive(row, b.mark) ? '#fff' : 'var(--cc-ink)'"
          @click="session.setMark(pos, row.attr, b.mark)"
        >
          {{ b.title }}
        </MTouch>
      </div>
    </div>

    <div class="dd-attr">
      <div class="dd-attr__label">组合</div>
      <div class="dd-attr__value" :style="{ '--chip-bg': comboColors.bg, '--chip-fg': comboColors.fg }">{{ comboLabel }}</div>
      <div class="dd-attr__note">下划线只到字母=组(声韵)；划到调号=组调(声韵调)</div>
      <div class="dd-attr__btns">
        <MTouch
          v-for="b in COMBO_BUTTONS"
          :key="b.kind"
          class="dd-attr__btn"
          :class="{ 'is-active': comboActive(b.kind) }"
          :style="{ '--btn-tint': b.tint }"
          :radius="8"
          :tint="comboActive(b.kind) ? '#fff' : 'var(--cc-ink)'"
          @click="session.setComboKind(pos, b.kind)"
        >
          {{ b.title }}
        </MTouch>
      </div>
    </div>
  </div>
</template>
