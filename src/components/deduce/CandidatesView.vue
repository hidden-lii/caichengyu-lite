<script setup lang="ts">
// 候选区（= CandidatesView.swift）：统计行 + 卡片网格。整卡点击 = 选中并复制；悬停片刻显示释义。
//
// 释义提示是画在候选区里的普通元素（不是系统弹层）：它不接收鼠标，点击直接落到卡片上。
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { trimUnicodeWhitespace, type DeduceResultItem, type DeduceSession } from "../../core";
import { copyText } from "../../platform";
import { Icon, MBadge, MButton, MCardButton, MSurface } from "../ui";
import FitText from "./FitText.vue";

const props = defineProps<{ session: DeduceSession }>();

const rootSurface = ref<{ $el: HTMLElement } | null>(null);
const root = computed<HTMLElement | null>(() => rootSurface.value?.$el ?? null);

// ---------- 悬停释义 ----------
/** 停留多久再显示（毫秒） */
const TIP_DELAY = 300;
let hoverWord: string | null = null;
let tipTimer: number | undefined;
const tipItem = ref<DeduceResultItem | null>(null);
const tipStyle = ref<Record<string, string>>({});

const tipText = computed(() => {
  const item = tipItem.value;
  return item ? trimUnicodeWhitespace(props.session.explanation(item)) : "";
});

function placeTip(card: HTMLElement): void {
  const host = root.value;
  if (!host) return;
  const h = host.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const width = Math.min(320, Math.max(180, h.width - 16));
  // 卡片在上半区就把提示放下面，否则放上面，免得被底边截掉
  const below = c.top - h.top + c.height / 2 < h.height * 0.55;
  const x = Math.min(Math.max(c.left - h.left, 8), Math.max(8, h.width - width - 8));
  tipStyle.value = {
    width: `${width}px`,
    left: `${x}px`,
    ...(below ? { top: `${c.bottom - h.top + 6}px` } : { bottom: `${h.bottom - c.top + 6}px` }),
  };
}

function hover(item: DeduceResultItem, inside: boolean, card: HTMLElement): void {
  window.clearTimeout(tipTimer);
  if (inside) {
    hoverWord = item.word;
    tipTimer = window.setTimeout(() => {
      if (hoverWord !== item.word) return;
      placeTip(card);
      tipItem.value = item;
    }, TIP_DELAY);
  } else {
    if (hoverWord === item.word) hoverWord = null;
    if (tipItem.value?.word === item.word) tipItem.value = null;
  }
}

/** 点击后收起。鼠标还停在原卡上，所以要等它离开再进入才会重新计时显示。 */
function dismissTip(): void {
  window.clearTimeout(tipTimer);
  tipItem.value = null;
}

// 候选列表变了：悬停 / 显示中的那张卡不在了（被筛掉），状态一并清掉
watch(
  () => props.session.state.items,
  (items) => {
    if (hoverWord !== null && !items.some((i) => i.word === hoverWord)) {
      window.clearTimeout(tipTimer);
      hoverWord = null;
    }
    const shown = tipItem.value;
    if (shown !== null && !items.includes(shown)) tipItem.value = null;
  },
);
onBeforeUnmount(() => window.clearTimeout(tipTimer));

// ---------- 复制 ----------
const copiedHint = ref<string | null>(null);
let copiedTimer: number | undefined;
function flashHint(text: string): void {
  copiedHint.value = text;
  window.clearTimeout(copiedTimer);
  copiedTimer = window.setTimeout(() => (copiedHint.value = null), 1600);
}
onBeforeUnmount(() => window.clearTimeout(copiedTimer));

async function pick(item: DeduceResultItem): Promise<void> {
  dismissTip();
  const word = props.session.selectCandidate(item);
  if (word === null) return;
  if (await copyText(word)) flashHint(`已复制「${word}」`);
  else props.session.reportSelectionCopyFailed(word);
}

async function copyAll(): Promise<void> {
  const words = await props.session.copyAllCandidates();
  if (words.length === 0) return;
  if (await copyText(words.join("\n"))) flashHint(`已复制全部 ${words.length} 条候选`);
  else props.session.reportCopyFailed();
}

const helperText = computed(() => {
  if (copiedHint.value !== null) return copiedHint.value;
  const meta = props.session.resultsMeta;
  return meta.length === 0 ? "点击卡片选中并复制 · 悬停片刻查看释义" : meta;
});
const helperClass = computed(() => ({
  "is-ok": copiedHint.value !== null,
  "is-err": copiedHint.value === null && props.session.state.error !== null,
}));

const selectedWord = computed(() => props.session.selectedWord);

// 滚动时收起释义（卡片位置变了，提示不再对得上）
function onScroll(): void {
  if (tipItem.value !== null) dismissTip();
}
</script>

<template>
  <MSurface ref="rootSurface" class="dd-panel dd-cand" fill="var(--cc-surface)" outline="var(--cc-border)">
    <div class="dd-panel__head dd-cand__head">
      <span class="dd-panel__title">候选</span>
      <MBadge :count="session.state.total" />
      <span class="dd-cand__spacer" />
      <MButton v-if="session.state.total > 0" kind="tonal" title="复制当前全部待选成语" @click="copyAll">
        <template #icon><Icon name="doc.on.doc" /></template>
        复制全部
      </MButton>
    </div>

    <div class="dd-panel__helper dd-cand__helper" :class="helperClass">{{ helperText }}</div>

    <div class="dd-scroll" @scroll.passive="onScroll">
      <div v-if="session.state.items.length === 0" class="dd-cand__empty">{{ session.resultsEmptyText }}</div>
      <template v-else>
        <div class="dd-cand__grid">
          <MCardButton
            v-for="item in session.state.items"
            :key="item.word"
            class="dd-card"
            :radius="16"
            :selected="selectedWord === item.word"
            @click="pick(item)"
            @mouseenter="hover(item, true, $event.currentTarget as HTMLElement)"
            @mouseleave="hover(item, false, $event.currentTarget as HTMLElement)"
          >
            <FitText class="dd-card__word" :text="item.word" :min-scale="0.7" />
            <span class="dd-card__pinyin">{{ item.pinyin }}</span>
            <!-- 选中后右上角弹出对勾（弹簧缩放 + 回正） -->
            <span class="dd-card__check"><Icon name="checkmark.circle.fill" /></span>
          </MCardButton>
        </div>
        <div v-if="session.resultsMoreText" class="dd-cand__more">{{ session.resultsMoreText }}</div>
      </template>
      <div class="dd-cand__tail" />
    </div>

    <div class="dd-tip-layer">
      <Transition name="dd-tip">
        <div v-if="tipItem" class="dd-tip" :style="tipStyle">
          <div class="dd-tip__head">
            <span class="dd-tip__word">{{ tipItem.word }}</span>
            <span class="dd-tip__pinyin">{{ tipItem.pinyin }}</span>
          </div>
          <div class="dd-tip__text" :class="{ 'is-empty': tipText.length === 0 }">
            {{ tipText.length === 0 ? "词库里没有这条的释义" : tipText }}
          </div>
          <div class="dd-tip__hint">点击选中并复制</div>
        </div>
      </Transition>
    </div>
  </MSurface>
</template>
