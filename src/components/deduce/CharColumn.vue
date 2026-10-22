<script setup lang="ts">
// 一个字位：字 + 读音输入框 + 声 / 韵 / 调 / 组 芯片 + 多音字读音切换。草稿与已记录猜测共用（= MarkChips.swift 的 CharColumn）。
import { computed, onMounted, ref, watch } from "vue";
import {
  DeduceSession,
  trimUnicodeWhitespace,
  toneDigit,
  type CharData,
  type MarkAttr,
  type MarkGesture,
  type MarkTarget,
  type PositionMarks,
} from "../../core";
import MarkChip from "./MarkChip.vue";
import PolyChips from "./PolyChips.vue";

const props = withDefaults(
  defineProps<{
    session: DeduceSession;
    target: MarkTarget;
    pos: number;
    ch: CharData;
    marks: PositionMarks;
    /** 折叠态：缩小，且不显示读音输入框与多音字切换 */
    compact?: boolean;
  }>(),
  { compact: false },
);

const digit = computed(() => props.ch.py + toneDigit(props.ch.tone));
const syllableText = ref("");
const syllableFocused = ref(false);

onMounted(() => (syllableText.value = digit.value));
watch(digit, (v) => {
  if (!syllableFocused.value) syllableText.value = v;
});

function handle(g: MarkGesture, attr: MarkAttr): void {
  const { session, target, pos } = props;
  switch (g) {
    case "primary":
      session.toggleMark(target, pos, attr);
      break;
    case "secondary":
      session.presentMark(target, pos, attr);
      break;
    case "chord":
      session.clearMark(target, pos, attr);
      break;
  }
}

function commitSyllable(): void {
  const raw = syllableText.value;
  if (trimUnicodeWhitespace(raw) === digit.value) return;
  if (props.target.kind === "draft") props.session.editDraftSyllable(props.pos, raw);
  else props.session.editHistorySyllable(props.target.index, props.pos, raw);
  // 提交失败（无法解析）时输入框回退到当前读音
  syllableText.value = digit.value;
}

function onFocus(): void {
  syllableFocused.value = true;
}
function onBlur(): void {
  syllableFocused.value = false;
  commitSyllable();
}
function onEnter(e: KeyboardEvent): void {
  if (e.isComposing) return;
  commitSyllable();
}

function pickReading(r: CharData): void {
  if (props.target.kind === "draft") props.session.chooseDraftReading(props.pos, r);
  else props.session.chooseHistoryReading(props.target.index, props.pos, r);
}

const comboHelp = "组合：右键循环 组(声韵)→组调(声韵调)→无 · 左键对/无 · 左右同时清除";
</script>

<template>
  <div class="dd-col" :class="{ 'is-compact': compact }">
    <MarkChip :text="ch.c" kind="char" :state="marks.char" :compact="compact" @gesture="handle($event, 'char')" />

    <!-- 读音输入格：直接改读音，如 jian4；回车或失焦提交 -->
    <input
      v-if="!compact"
      v-model="syllableText"
      class="dd-syl"
      type="text"
      spellcheck="false"
      autocomplete="off"
      autocapitalize="off"
      title="直接改读音，如 jian4"
      @focus="onFocus"
      @blur="onBlur"
      @keydown.enter="onEnter"
    />

    <div class="dd-col__chips">
      <MarkChip
        v-if="ch.sm.length > 0"
        :text="ch.sm"
        :state="marks.sm"
        :auto="marks.autoSm"
        :combo-underline="marks.combo === 'present'"
        :compact="compact"
        @gesture="handle($event, 'sm')"
      />
      <MarkChip
        :text="ch.ym.length === 0 ? ch.py : ch.ym"
        :state="marks.ym"
        :auto="marks.autoYm"
        :combo-underline="marks.combo === 'present'"
        :compact="compact"
        @gesture="handle($event, 'ym')"
      />
      <MarkChip
        :text="toneDigit(ch.tone)"
        :state="marks.tone"
        :auto="marks.autoTone"
        :combo-underline="marks.combo === 'present' && marks.comboTone"
        :compact="compact"
        @gesture="handle($event, 'tone')"
      />
      <MarkChip
        :text="DeduceSession.comboNodeLabel(marks)"
        kind="combo"
        :state="marks.combo"
        :compact="compact"
        :help="comboHelp"
        @gesture="handle($event, 'combo')"
      />
    </div>

    <PolyChips v-if="!compact && session.isPolyphone(ch)" :readings="session.polyReadings(ch)" :current="ch" @pick="pickReading" />
  </div>
</template>
