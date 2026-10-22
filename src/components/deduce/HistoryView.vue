<script setup lang="ts">
// 已记录猜测（= MarkStageView.swift 的 HistoryView / HistoryItem）：展开 / 折叠、重新开始、删除。
import { formatReading, historyTarget, type DeduceGuess, type DeduceSession } from "../../core";
import { Icon, MBadge, MIconButton, MSurface, MTouch } from "../ui";
import CharColumn from "./CharColumn.vue";
import CharRow from "./CharRow.vue";

defineProps<{ session: DeduceSession }>();

const readingsOf = (g: DeduceGuess): string => g.chars.map((c) => formatReading(c)).join(" ");
</script>

<template>
  <MSurface class="dd-panel dd-history" fill="var(--cc-surface)" outline="var(--cc-border)">
    <div class="dd-panel__head">
      <span class="dd-panel__title">已记录猜测</span>
      <MBadge :count="session.state.guesses.length" />
    </div>
    <div class="dd-panel__helper">
      {{
        session.state.guesses.length === 0
          ? "确认标记后会出现在这里"
          : "可直接改标记与读音：左键对 ↔ 无 · 右键偏 · 左右同时清除"
      }}
    </div>

    <div class="dd-scroll">
      <div class="dd-hist-list">
        <MSurface
          v-for="(g, idx) in session.state.guesses"
          :key="idx"
          class="dd-hist"
          fill="var(--cc-surface-low)"
          radius="var(--cc-history-radius)"
        >
          <div class="dd-hist__head">
            <!-- 整条标题行都能点：展开 / 折叠 -->
            <MTouch
              class="dd-hist__title"
              :radius="12"
              tint="var(--cc-ink)"
              :press-scale="1"
              :title="session.isHistoryExpanded(idx) ? '折叠' : '展开'"
              @click="session.toggleHistoryExpanded(idx)"
            >
              <span class="dd-hist__row">
                <span class="dd-hist__word">{{ g.word }}</span>
                <span class="dd-hist__pinyin">{{ readingsOf(g) }}</span>
              </span>
            </MTouch>
            <MIconButton
              :size="32"
              icon="arrow.counterclockwise"
              label="重新开始"
              :title="`重新开始：清空全部已记录猜测，以「${g.word}」作为第一个词重新标记（一轮猜完后开始下一轮）`"
              @click="session.requestRestart(idx)"
            />
            <MIconButton
              :size="32"
              :label="session.isHistoryExpanded(idx) ? '折叠' : '展开'"
              @click="session.toggleHistoryExpanded(idx)"
            >
              <Icon name="chevron.down" class="dd-chevron" :class="{ 'is-open': session.isHistoryExpanded(idx) }" />
            </MIconButton>
            <MIconButton :size="32" icon="trash" label="删除这一条" @click="session.removeGuess(idx)" />
          </div>
          <CharRow
            :count="g.chars.length"
            :min-column-width="session.isHistoryExpanded(idx) ? 112 : 84"
            :spacing="8"
          >
            <template #default="{ i }">
              <CharColumn
                v-if="g.marks[i]"
                :session="session"
                :target="historyTarget(idx)"
                :pos="i"
                :ch="g.chars[i]!"
                :marks="g.marks[i]!"
                :compact="!session.isHistoryExpanded(idx)"
              />
            </template>
          </CharRow>
        </MSurface>
      </div>
    </div>
  </MSurface>
</template>
