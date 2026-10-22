<script setup lang="ts">
// 标记台（= MarkStageView.swift）：当前词的字 / 读音 / 声韵调组着色预览 + 操作行。常驻，不随滚动消失。
// M3 版式：大圆角色块卡片，标题是大字成语 + 拼音，右上角是「取消选择 / 详细」；「确认并筛选」是右下角的 FAB（在 DeduceView 里）。
import { onBeforeUnmount, ref, watch } from "vue";
import { draftTarget, formatReading, type DeduceSession } from "../../core";
import { Icon, MButton, MSurface } from "../ui";
import CharColumn from "./CharColumn.vue";
import CharRow from "./CharRow.vue";
import FitText from "./FitText.vue";

const props = defineProps<{ session: DeduceSession }>();

// 选中候选 / 重新开始时标记台边缘闪一下：亮 0.08s、停 0.09s、退 0.45s
const flashOpacity = ref(0);
const flashDuration = ref(0.08);
let flashTimer: number | undefined;
watch(
  () => props.session.state.stageFlashTick,
  () => {
    window.clearTimeout(flashTimer);
    flashDuration.value = 0.08;
    flashOpacity.value = 0.9;
    flashTimer = window.setTimeout(() => {
      flashDuration.value = 0.45;
      flashOpacity.value = 0;
    }, 90);
  },
);
onBeforeUnmount(() => window.clearTimeout(flashTimer));

function onPinyinEnter(e: KeyboardEvent): void {
  if (!e.isComposing) props.session.applyPinyin();
}
</script>

<template>
  <MSurface class="dd-stage" fill="var(--cc-stage)" elevation="e1">
    <!-- 词库未收录：手填整段读音 -->
    <div v-if="session.pinyinBarVisible" class="dd-pinyinbar">
      <input
        v-model="session.state.pinyinInput"
        class="dd-pinyinbar__input"
        type="text"
        spellcheck="false"
        autocomplete="off"
        placeholder="词库未收录，填写读音如 dan4 wu2 xu1 fa1"
        @keydown.enter="onPinyinEnter"
      />
      <MButton kind="tonal" @click="session.applyPinyin()">应用</MButton>
    </div>

    <!-- 当前草稿 -->
    <div v-if="session.state.draft" class="dd-guess">
      <div class="dd-guess__head">
        <div class="dd-guess__title">
          <FitText class="dd-guess__word" :text="session.state.draft.word" :min-scale="0.6" />
          <div class="dd-guess__pinyin">{{ session.state.draft.chars.map((c) => formatReading(c)).join(" ") }}</div>
        </div>
        <div class="dd-guess__actions">
          <MButton
            v-if="session.pinyinDirty"
            kind="tonal"
            title="把改过的读音应用到当前猜测，并确认是否写入词库"
            @click="session.applyDraftPinyin()"
          >
            <template #icon><Icon name="arrow.triangle.2.circlepath" /></template>
            应用读音
          </MButton>
          <MButton
            v-if="session.hasSelection"
            kind="text"
            title="只清掉当前选中的词和它的标记，已记录的猜测与筛选结果不变"
            @click="session.clearSelection()"
          >
            <template #icon><Icon name="xmark" /></template>
            取消选择
          </MButton>
          <MButton kind="tonal" title="打开详细标记：逐字选对/偏/无、改声调与声韵组合" @click="session.state.showDetailPanel = true">
            <template #icon><Icon name="slider.horizontal.3" /></template>
            详细
          </MButton>
        </div>
      </div>
      <CharRow :count="session.state.draft.chars.length" :min-column-width="112" :spacing="10">
        <template #default="{ i }">
          <CharColumn
            v-if="session.state.draft.marks[i]"
            :session="session"
            :target="draftTarget"
            :pos="i"
            :ch="session.state.draft.chars[i]!"
            :marks="session.state.draft.marks[i]!"
          />
        </template>
      </CharRow>
    </div>

    <!-- 空态 -->
    <div v-if="session.isStageEmpty" class="dd-empty">
      <div class="dd-empty__icon"><Icon name="text.magnifyingglass" /></div>
      <div class="dd-empty__title">从右侧候选点一个，或在上方输入成语</div>
      <div class="dd-empty__sub">标记台常驻于此，选中后无需往回滚动</div>
    </div>

    <!-- 没有草稿时的操作行 -->
    <div v-if="session.state.draft === null && session.hasSelection" class="dd-stage__actions">
      <MButton kind="text" title="只清掉当前选中的词和它的标记，已记录的猜测与筛选结果不变" @click="session.clearSelection()">
        <template #icon><Icon name="xmark" /></template>
        取消选择
      </MButton>
    </div>

    <span class="dd-stage__flash" :style="{ opacity: flashOpacity, transition: `opacity ${flashDuration}s ease-out` }" />
  </MSurface>
</template>
