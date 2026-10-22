<script setup lang="ts">
// 「猜成语」工作台（= DeduceView.swift）：应用栏（搜索栏 + 状态 + 外观 + 设置）、工具行、左（标记台 + 已记录）右（候选）双栏，
// 右下角是「确认并筛选」FAB；三个确认框（清空全部 / 清空后重新开始 / 写库确认）与「详细」弹层、写库进行中的遮罩也都在这里。
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  DeduceSession,
  persistDialogCancelTitle,
  persistDialogConfirmTitle,
  persistDialogPrompt,
  persistDialogTitle,
  type PersistDialog,
} from "../../core";
import { copyText } from "../../platform";
import AppBar from "../AppBar.vue";
import { Icon, MBusyOverlay, MButton, MDialog, MFab } from "../ui";
import CandidatesView from "./CandidatesView.vue";
import DetailSheet from "./DetailSheet.vue";
import HistoryView from "./HistoryView.vue";
import MarkStage from "./MarkStage.vue";
import SearchBar from "./SearchBar.vue";
import {
  clearGestureHint,
  commitShortcutLabel,
  hasCommandModifier,
  hasOpenModal,
  presentGestureHint,
} from "./shortcuts";
import "./deduce.css";

const props = defineProps<{ session: DeduceSession }>();

// ============================ 搜索栏 ============================
const searchBar = ref<{ focus: () => void } | null>(null);
const focusInput = (): void => searchBar.value?.focus();

// ============================ 工具行 ============================
const polyHelp = computed(() =>
  props.session.includePolyphones
    ? "已开启：多音字始终参与筛选（点击关闭，恢复为仅无结果时保底）"
    : "默认仅在无候选时用多音字保底；点击后始终让多音字参与筛选",
);
const message = computed(() => props.session.state.message);

// ============================ 确认框 ============================
// 写库确认框：关闭动画期间 state 已经是 null，文案要留着，不然淡出时会闪一下空白
const lastPersist = ref<PersistDialog | null>(null);
watch(
  () => props.session.state.persistDialog,
  (d) => {
    if (d !== null) lastPersist.value = { ...d };
  },
  { immediate: true },
);
const persistDialog = computed(() => props.session.state.persistDialog ?? lastPersist.value);

const lastRestart = ref(props.session.state.restartRequest);
watch(
  () => props.session.state.restartRequest,
  (r) => {
    if (r !== null) lastRestart.value = { ...r };
  },
  { immediate: true },
);
const restartMessage = computed(() => (lastRestart.value ? DeduceSession.restartConfirmBody(lastRestart.value) : ""));

/** 用户在确认框里点了「清空并重新开始」：清空、以该词重新开始，并把这个词复制到剪贴板。 */
async function confirmRestart(): Promise<void> {
  const word = props.session.confirmRestart();
  if (word === null) return;
  if (!(await copyText(word))) props.session.reportRestartCopyFailed(word);
}

// ============================ FAB ============================
const commitKbd = computed(() => commitShortcutLabel());

// ============================ 手势图例 ============================
// 按键写法随平台变（macOS：⌥ ⇧；Windows / Linux：Alt Shift），平台在挂载前就定了，取一次即可
const presentHint = presentGestureHint();
const clearHint = clearGestureHint();

// ============================ 快捷键 ============================
function onKeydown(e: KeyboardEvent): void {
  if (e.isComposing || e.defaultPrevented || !hasCommandModifier(e) || e.altKey) return;
  // 模态层（详细标记、确认框、设置）开着时，主界面的快捷键不生效
  if (hasOpenModal()) return;
  if (e.key === "l" || e.key === "L") {
    // ⌘L 聚焦输入框
    e.preventDefault();
    focusInput();
  } else if (e.key === "Enter" && props.session.canCommit) {
    // ⌘↩ 确认本条并筛选
    e.preventDefault();
    props.session.commitGuess();
  }
}

onMounted(() => {
  window.addEventListener("keydown", onKeydown);
  focusInput();
});
onBeforeUnmount(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="dd-root">
    <AppBar>
      <SearchBar ref="searchBar" :session="session" />
    </AppBar>

    <!-- 工具行 -->
    <div class="dd-toolrow">
      <MButton
        kind="filter"
        :active="session.includePolyphones"
        :title="polyHelp"
        @click="session.includePolyphones = !session.includePolyphones"
      >
        多音字筛选
      </MButton>
      <!-- 提示行常驻、占位固定：没有提示时只是不显示文字，不会让下面的工作台上下挪动 -->
      <div class="dd-message m-selectable" :class="message ? `is-${message.kind}` : ''" :title="message?.text ?? ''">
        {{ message?.text ?? " " }}
      </div>
      <!-- 手势图例常驻，不必再靠 tooltip 记忆 -->
      <div class="dd-legend">
        <span class="dd-legend__item">
          <span class="dd-legend__swatch" style="background: var(--cc-hit)" />对
          <span class="dd-legend__arrow">⇄</span>
          <span class="dd-legend__swatch" style="background: var(--cc-absent)" />无
          <span class="dd-legend__hint">左键</span>
        </span>
        <span class="dd-legend__item">
          <span class="dd-legend__swatch" style="background: var(--cc-present)" />偏
          <span class="dd-legend__hint">{{ presentHint }}</span>
        </span>
        <span class="dd-legend__item">清除<span class="dd-legend__hint">{{ clearHint }}</span></span>
      </div>
      <MButton kind="textDanger" @click="session.requestClearAll()">
        <template #icon><Icon name="trash.slash" /></template>
        清空全部
      </MButton>
    </div>

    <!-- 双栏：左（标记台 + 已记录）右（候选） -->
    <div class="dd-workbench">
      <div class="dd-left">
        <MarkStage :session="session" />
        <HistoryView :session="session" />
      </div>
      <CandidatesView :session="session" />
    </div>

    <!-- 「确认本条并筛选 ⌘↩」：有草稿时才出现，从右下角弹簧弹出 / 收起 -->
    <Transition name="m-fab">
      <MFab v-if="session.canCommit" class="dd-fab" :title="commitKbd" @click="session.commitGuess()">
        <Icon name="checkmark" weight="semibold" style="font-size: 20px" />
        <span>{{ session.commitButtonTitle }}</span>
        <span class="dd-fab__kbd">{{ commitKbd }}</span>
      </MFab>
    </Transition>

    <!-- 写库进行中 -->
    <MBusyOverlay v-if="session.state.lexiconBusyText" :text="session.state.lexiconBusyText" detail="界面可继续显示，请稍候" />

    <DetailSheet :session="session" />

    <!-- 读音写库确认 -->
    <MDialog
      :model-value="session.state.persistDialog !== null"
      :title="persistDialog ? persistDialogTitle(persistDialog) : ''"
      :message="persistDialog ? persistDialogPrompt(persistDialog) : ''"
      :confirm-text="persistDialog ? persistDialogConfirmTitle(persistDialog) : '确定'"
      :cancel-text="persistDialogCancelTitle"
      @confirm="session.confirmPersistPinyin()"
      @cancel="session.cancelPersistPinyin()"
    />
    <!-- 清空全部 -->
    <MDialog
      :model-value="session.state.clearConfirmOpen"
      :title="DeduceSession.clearConfirmTitle"
      :message="DeduceSession.clearConfirmBody"
      :confirm-text="DeduceSession.clearConfirmActionTitle"
      :cancel-text="DeduceSession.clearCancelTitle"
      destructive
      @confirm="session.confirmClearAll()"
      @cancel="session.cancelClearAll()"
    />
    <!-- 以此词重新开始 -->
    <MDialog
      :model-value="session.state.restartRequest !== null"
      :title="DeduceSession.restartConfirmTitle"
      :message="restartMessage"
      :confirm-text="DeduceSession.restartConfirmActionTitle"
      :cancel-text="DeduceSession.clearCancelTitle"
      @confirm="confirmRestart"
      @cancel="session.cancelRestart()"
    />
  </div>
</template>
