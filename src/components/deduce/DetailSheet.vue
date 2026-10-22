<script setup lang="ts">
// 「详细」弹层（= DetailSheet.swift）：逐字、逐部件精确设置 对 / 偏 / 无，改声调，设声韵组合。
// 宽度 700 只是基础值：字数多（一列 148 宽）放不下时，MSheet 会把弹层加宽到刚好放下，最宽到窗口边缘，超出才出现横向滚动条。
import { computed } from "vue";
import type { DeduceSession } from "../../core";
import { MButton, MSheet } from "../ui";
import PositionColumn from "./PositionColumn.vue";

const props = defineProps<{ session: DeduceSession }>();

const open = computed(() => props.session.detailPanelVisible);

function setOpen(v: boolean): void {
  props.session.state.showDetailPanel = v;
}

/** Enter = 默认按钮「完成」（焦点在按钮 / 下拉里时让它们自己处理） */
function onKeydown(e: KeyboardEvent): void {
  if (e.key !== "Enter" || e.isComposing) return;
  const t = e.target;
  if (t instanceof HTMLElement && ["BUTTON", "SELECT", "INPUT", "TEXTAREA"].includes(t.tagName)) return;
  e.preventDefault();
  setOpen(false);
}
</script>

<template>
  <MSheet :model-value="open" :width="700" label="详细标记" @update:model-value="setOpen">
    <div v-if="session.state.draft" class="dd-detail" tabindex="-1" data-autofocus @keydown="onKeydown">
      <div class="dd-detail__head">
        <h2 class="dd-detail__title">详细标记 · {{ session.state.draft.word }}</h2>
        <MButton kind="text" compact @click="setOpen(false)">关闭</MButton>
      </div>
      <div class="dd-detail__body">
        <div class="dd-detail__cols">
          <template v-for="(ch, pos) in session.state.draft.chars" :key="pos">
            <PositionColumn
              v-if="session.state.draft.marks[pos]"
              :session="session"
              :pos="pos"
              :ch="ch"
              :marks="session.state.draft.marks[pos]!"
            />
          </template>
        </div>
      </div>
      <div class="dd-detail__foot">
        <MButton v-if="session.pinyinDirty" kind="text" compact @click="session.applyDraftPinyin()">应用读音</MButton>
        <MButton kind="filled" compact @click="setOpen(false)">完成</MButton>
      </div>
    </div>
  </MSheet>
</template>
