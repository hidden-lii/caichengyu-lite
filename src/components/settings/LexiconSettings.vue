<script setup lang="ts">
// 词库设置（移植自 SettingsView.swift 的 LexiconSettingsView）：内置源多选与优先级、词条维护。设置弹层里的「词库」页。
// 文案逐字照抄 Swift。宽度跟着设置弹层走（基础 640，放不下时弹层会自己加宽，见 MSheet），高度由设置弹层决定（内容超出时整页滚动）。
//
// · 已选来源的顺序即优先级（第 0 位最高）；可拖动排序（Pointer Events 自己实现，无依赖），也可点 ▲▼ 微调。
// · 初始勾选来自当前快照的 sources，**在 setup 里同步取好**：打开的第一帧就是正确的勾选态，
//   不要先空着再异步填（mac 版修过的卡顿问题：多一次整表重绘，肉眼可见地闪一下）。
// · 应用来源 / 新增 / 改读音 / 删除都走 `model.store`，成功后 `model.adopt(result.snapshot)`；进行中用 MBusyOverlay 盖住本页。
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useAppModel } from "../../app/context";
import { LexiconCatalog, outcomeChanged, trimUnicodeWhitespace } from "../../core";
import type { BuiltinLexicon, LexiconProgress } from "../../core";
import type { LexiconStore } from "../../core/lexicon/store";
import type { MutationResult, UpsertOutcome } from "../../core/lexicon/types";
import { Icon, MBusyOverlay, MButton, MCheckbox, MDialog, MTextField } from "../ui";

const model = useAppModel();

/** 已选来源，顺序即优先级（第 0 位最高）。同步初始化。 */
const selected = ref<string[]>([...(model.state.snapshot?.sources ?? [])]);
const busyText = ref<string | null>(null);
interface Note {
  text: string;
  isError: boolean;
}
const note = ref<Note | null>(null);
const confirmApply = ref(false);
const confirmDelete = ref(false);

// 词条维护
const word = ref("");
const pinyin = ref("");
const explanation = ref("");

const catalog: readonly BuiltinLexicon[] = LexiconCatalog.all;
const unselected = computed(() => catalog.filter((l) => !selected.value.includes(l.id)));
const currentSources = computed<readonly string[]>(() => model.state.snapshot?.sources ?? []);
const dirty = computed(() => {
  const a = selected.value;
  const b = currentSources.value;
  return a.length !== b.length || a.some((id, i) => id !== b[i]);
});
const trimmedWord = computed(() => trimUnicodeWhitespace(word.value));
const canEdit = computed(() => trimmedWord.value.length > 0 && trimUnicodeWhitespace(pinyin.value).length > 0);

function infoOf(id: string): { name: string; description: string } {
  return LexiconCatalog.info(id) ?? { name: id, description: "" };
}

// MARK: - 勾选 / 排序

function toggle(id: string): void {
  const list = selected.value.slice();
  const i = list.indexOf(id);
  if (i >= 0) {
    list.splice(i, 1);
  } else {
    // 按默认优先级插入到合适位置，再由用户拖动调整
    const priority = LexiconCatalog.info(id)?.defaultPriority ?? 99;
    const at = list.findIndex((x) => (LexiconCatalog.info(x)?.defaultPriority ?? 99) > priority);
    list.splice(at < 0 ? list.length : at, 0, id);
  }
  selected.value = list;
}

function move(id: string, by: number): void {
  const list = selected.value.slice();
  const i = list.indexOf(id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j]!, list[i]!];
  selected.value = list;
}

function restoreDefault(): void {
  selected.value = LexiconCatalog.defaultSelection;
}

// MARK: - 拖动排序（Pointer Events）
// 行高固定 44：被拖的行跟着指针走，其余行让出一格（transform + 过渡）；松手时按落点重排。
// 指针靠近列表上 / 下沿时自动滚动；Esc 取消。只响应鼠标 / 笔（触摸屏用 ▲▼ 按钮）。

const ROW_H = 44;
const DRAG_THRESHOLD = 4;

interface DragState {
  id: string;
  from: number;
  to: number;
  pointerId: number;
  startY: number;
  startScroll: number;
  clientY: number;
  dy: number;
  /** 被拖行的视觉位移（限制在列表范围内） */
  clampedDy: number;
  /** 移动超过阈值后才算开始拖动（否则只是点了一下） */
  active: boolean;
}
const drag = ref<DragState | null>(null);
const listScroll = ref<HTMLElement | null>(null);
let raf = 0;

function refreshDrag(d: DragState): void {
  const sc = listScroll.value;
  const n = selected.value.length;
  d.dy = d.clientY - d.startY + ((sc?.scrollTop ?? 0) - d.startScroll);
  d.clampedDy = Math.min(Math.max(d.dy, -d.from * ROW_H), (n - 1 - d.from) * ROW_H);
  d.to = Math.min(Math.max(Math.round(d.from + d.dy / ROW_H), 0), n - 1);
}

function onRowDown(e: PointerEvent, id: string, index: number): void {
  if (e.button !== 0 || e.pointerType === "touch" || drag.value) return;
  if ((e.target as HTMLElement).closest("button")) return;
  drag.value = {
    id,
    from: index,
    to: index,
    pointerId: e.pointerId,
    startY: e.clientY,
    startScroll: listScroll.value?.scrollTop ?? 0,
    clientY: e.clientY,
    dy: 0,
    clampedDy: 0,
    active: false,
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
}

function onMove(e: PointerEvent): void {
  const d = drag.value;
  if (!d || e.pointerId !== d.pointerId) return;
  d.clientY = e.clientY;
  if (!d.active && Math.abs(e.clientY - d.startY) > DRAG_THRESHOLD) {
    d.active = true;
    raf = requestAnimationFrame(autoScroll);
  }
  if (d.active) refreshDrag(d);
}

/** 指针靠近列表上 / 下沿时滚动列表（离边越近越快），每帧重算落点 */
function autoScroll(): void {
  const d = drag.value;
  const sc = listScroll.value;
  if (!d || !d.active || !sc) return;
  const r = sc.getBoundingClientRect();
  const edge = 32;
  let v = 0;
  if (d.clientY < r.top + edge) v = -Math.ceil(((r.top + edge - d.clientY) / edge) * 14);
  else if (d.clientY > r.bottom - edge) v = Math.ceil(((d.clientY - (r.bottom - edge)) / edge) * 14);
  if (v !== 0) sc.scrollTop += v;
  refreshDrag(d);
  raf = requestAnimationFrame(autoScroll);
}

function endDrag(): void {
  cancelAnimationFrame(raf);
  window.removeEventListener("pointermove", onMove);
  window.removeEventListener("pointerup", onUp);
  window.removeEventListener("pointercancel", onCancel);
  window.removeEventListener("keydown", onKey, true);
  drag.value = null;
}

function onUp(e: PointerEvent): void {
  const d = drag.value;
  if (!d || e.pointerId !== d.pointerId) return;
  if (d.active) {
    refreshDrag(d);
    if (d.to !== d.from) {
      const list = selected.value.slice();
      const [m] = list.splice(d.from, 1);
      list.splice(d.to, 0, m!);
      selected.value = list;
    }
  }
  endDrag();
}

function onCancel(): void {
  endDrag();
}

function onKey(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  // 拖动中的 Esc 只取消拖动，不要把设置弹层一起关掉
  e.preventDefault();
  e.stopPropagation();
  endDrag();
}

onBeforeUnmount(endDrag);

/** 已选行的位移：被拖行跟手，夹在中间的行让出一格 */
function rowStyle(index: number): Record<string, string> | undefined {
  const d = drag.value;
  if (!d || !d.active) return undefined;
  if (index === d.from) return { transform: `translateY(${d.clampedDy}px)` };
  if (d.from < d.to && index > d.from && index <= d.to) return { transform: `translateY(${-ROW_H}px)` };
  if (d.from > d.to && index >= d.to && index < d.from) return { transform: `translateY(${ROW_H}px)` };
  return { transform: "translateY(0)" };
}

// MARK: - 动作

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 进度回调：只在仍忙碌时更新文案（晚到的回调不能把已经收起的遮罩又顶出来） */
const progress: LexiconProgress = (text) => {
  if (busyText.value !== null) busyText.value = text;
};

/** 打开时没带上快照（加载失败后进设置）就从词库存储读回来；带了就不必再读、再重绘一遍 */
async function loadSelection(): Promise<void> {
  if (selected.value.length > 0) return;
  const ids = await model.store.selectedSources();
  if (selected.value.length === 0) selected.value = ids;
}
onMounted(() => {
  void loadSelection();
});

async function applySources(): Promise<void> {
  busyText.value = "正在应用词库…";
  note.value = null;
  try {
    const result = await model.store.applySources(selected.value, progress);
    model.adopt(result.snapshot);
    selected.value = [...result.snapshot.sources];
    note.value = {
      text: `已应用 ${result.snapshot.sources.length} 个来源，共 ${result.snapshot.count} 条（跳过 ${result.snapshot.skipped} 条）`,
      isError: false,
    };
  } catch (e) {
    note.value = { text: errorText(e), isError: true };
  } finally {
    busyText.value = null;
  }
}

async function mutate(
  busy: string,
  run: (store: LexiconStore) => Promise<MutationResult>,
  success: (outcome: UpsertOutcome) => string,
): Promise<void> {
  busyText.value = busy;
  note.value = null;
  try {
    const result = await run(model.store);
    if (outcomeChanged(result.outcome)) {
      model.adopt(result.snapshot);
      note.value = { text: success(result.outcome), isError: false };
    } else {
      note.value = { text: result.outcome.errors[0] ?? "没有发生改动", isError: true };
    }
  } catch (e) {
    note.value = { text: errorText(e), isError: true };
  } finally {
    busyText.value = null;
  }
}

function addIdiom(): Promise<void> {
  const w = trimmedWord.value;
  return mutate(
    "正在写入词库…",
    (store) => store.addIdiom(word.value, pinyin.value, explanation.value, progress),
    (outcome) => (outcome.added > 0 ? `已新增「${w}」` : `已更新「${w}」`),
  );
}

function updatePinyin(): Promise<void> {
  const w = trimmedWord.value;
  return mutate(
    "正在更新读音…",
    (store) => store.updatePinyin(word.value, pinyin.value, progress),
    () => `已更新「${w}」的读音`,
  );
}

function deleteIdiom(): Promise<void> {
  const w = trimmedWord.value;
  return mutate(
    "正在删除…",
    (store) => store.deleteIdiom(word.value, progress),
    () => `已删除「${w}」`,
  );
}
</script>

<template>
  <div class="lx">
    <!-- 忙碌时整页不可操作（= .disabled(busyText != nil)） -->
    <div class="lx-scroll" v-bind="busyText !== null ? { inert: 'true' } : {}">
      <div class="lx-content">
        <!-- 词库来源 -->
        <section class="lx-section">
          <h3 class="lx-title">词库来源</h3>
          <p class="lx-note">
            勾选多个内置源并调整优先级。应用后整库替换为所选源的并集；同一词出现在多个源时，拼音与释义以优先级最高的源为准（释义为空时回落到较低优先级的非空值）。
          </p>

          <div class="lx-list">
            <div ref="listScroll" class="lx-list__scroll" :class="{ 'is-dragging': drag?.active }">
              <div class="lx-sec-head">已选（上方优先级更高，可拖动排序）</div>
              <div class="lx-rows">
                <div
                  v-for="(id, index) in selected"
                  :key="id"
                  class="lx-row lx-row--movable"
                  :class="{
                    'is-last': index === selected.length - 1,
                    'is-dragged': drag?.active && drag.from === index,
                    'is-shifting': drag?.active && drag.from !== index,
                  }"
                  :style="rowStyle(index)"
                  @pointerdown="onRowDown($event, id, index)"
                >
                  <MCheckbox :model-value="true" @update:model-value="toggle(id)" />
                  <span class="lx-rank">{{ index + 1 }}</span>
                  <div class="lx-row__text">
                    <div class="lx-row__name">{{ infoOf(id).name }}</div>
                    <div class="lx-row__desc">{{ infoOf(id).description }}</div>
                  </div>
                  <div class="lx-row__moves">
                    <button class="lx-chev" type="button" aria-label="上移" :disabled="index === 0" @click="move(id, -1)">
                      <Icon name="chevron.up" weight="semibold" />
                    </button>
                    <button
                      class="lx-chev"
                      type="button"
                      aria-label="下移"
                      :disabled="index === selected.length - 1"
                      @click="move(id, 1)"
                    >
                      <Icon name="chevron.down" weight="semibold" />
                    </button>
                  </div>
                </div>
              </div>

              <template v-if="unselected.length > 0">
                <div class="lx-sec-head lx-sec-head--next">未选</div>
                <div class="lx-rows">
                  <div
                    v-for="(info, index) in unselected"
                    :key="info.id"
                    class="lx-row"
                    :class="{ 'is-last': index === unselected.length - 1 }"
                  >
                    <MCheckbox :model-value="false" @update:model-value="toggle(info.id)" />
                    <div class="lx-row__text">
                      <div class="lx-row__name">{{ info.name }}</div>
                      <div class="lx-row__desc">{{ info.description }}</div>
                    </div>
                  </div>
                </div>
              </template>
            </div>
          </div>

          <div class="lx-actions">
            <MButton kind="text" compact @click="restoreDefault">恢复默认全选</MButton>
            <span class="lx-spacer" />
            <span v-if="selected.length === 0" class="lx-hint lx-hint--danger">请至少选择一个内置词库</span>
            <span v-else-if="dirty" class="lx-hint lx-hint--warn">有未应用的更改</span>
            <MButton kind="filled" compact :disabled="selected.length === 0 || !dirty" @click="confirmApply = true">应用</MButton>
          </div>
          <p v-if="note" class="lx-result m-selectable" :class="note.isError ? 'is-error' : 'is-ok'">{{ note.text }}</p>
        </section>

        <hr class="lx-divider" />

        <!-- 词条维护 -->
        <section class="lx-section">
          <h3 class="lx-title">词条维护</h3>
          <p class="lx-note">新增一个词、修改某个词的读音，或删除某个词。改动保存在本机，切换词库来源后依然生效。</p>

          <label class="lx-field">
            <span class="lx-field__label">成语</span>
            <MTextField v-model="word" fill="var(--cc-surface)" placeholder="如：弹无虚发" />
          </label>
          <label class="lx-field">
            <span class="lx-field__label">读音</span>
            <MTextField v-model="pinyin" fill="var(--cc-surface)" placeholder="如：dan4 wu2 xu1 fa1 或 dàn wú xū fā" />
          </label>
          <label class="lx-field">
            <span class="lx-field__label">释义</span>
            <MTextField v-model="explanation" fill="var(--cc-surface)" placeholder="可选，仅新增时使用" />
          </label>

          <div class="lx-actions">
            <MButton kind="filled" compact :disabled="!canEdit" title="词已存在时，读音与释义都会被覆盖" @click="addIdiom">
              新增 / 覆盖
            </MButton>
            <MButton kind="text" compact :disabled="!canEdit" title="词必须已在词库中，保留原释义" @click="updatePinyin">
              只改读音
            </MButton>
            <span class="lx-spacer" />
            <MButton kind="textDanger" compact :disabled="trimmedWord.length === 0" @click="confirmDelete = true">删除该词</MButton>
          </div>
        </section>
      </div>
    </div>

    <MBusyOverlay v-if="busyText !== null" :text="busyText" variant="panel" />

    <MDialog
      v-model="confirmApply"
      title="应用所选词库？"
      :message="`将整库替换为所选 ${selected.length} 个来源的并集。你新增或修改过的词条会保留。`"
      confirm-text="应用"
      destructive
      @confirm="applySources"
    />
    <MDialog
      v-model="confirmDelete"
      :title="`删除「${trimmedWord}」？`"
      message="只影响当前词库；切换词库来源后，若该词仍存在于来源中会再次出现。"
      confirm-text="删除"
      destructive
      @confirm="deleteIdiom"
    />
  </div>
</template>

<style scoped>
.lx {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
  background: var(--cc-bg);
  color: var(--cc-ink);
}
.lx-scroll {
  height: 100%;
  overflow-y: auto;
}
.lx-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 20px;
}
.lx-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
/* 标题（serif(18) semibold）与说明（serif(12.5)）：汉字变窄由全局 "CC CJK" 别名处理，这里写 Swift 的原值
 * （对应的行高：标题 ≈ 20，说明两行间距 ≈ 15.5） */
.lx-title {
  margin: 0;
  font-family: var(--cc-font-ui);
  font-size: calc(18px * var(--cc-font-scale));
  font-weight: 600;
  line-height: calc(20 / 18);
}
.lx-note {
  margin: 0;
  font-family: var(--cc-font-ui);
  font-size: calc(12.5px * var(--cc-font-scale));
  line-height: calc(15.5 / 12.5);
  color: var(--cc-muted);
}
.lx-divider {
  flex: none;
  height: 1px;
  margin: 0;
  border: 0;
  background: color-mix(in srgb, var(--cc-ink) 14%, transparent);
}

/* —— 来源列表（= List(.inset) + surface 底 + 圆角 8 + 1px border，高 330） —— */
.lx-list {
  position: relative;
  flex: none;
  height: 330px;
  border-radius: 8px;
  background: var(--cc-surface);
  overflow: hidden;
}
.lx-list::after {
  content: "";
  position: absolute;
  inset: 0;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px var(--cc-border);
  pointer-events: none;
}
.lx-list__scroll {
  height: 100%;
  overflow-x: hidden;
  overflow-y: auto;
  padding-right: 16px;
  padding-bottom: 8px;
}
.lx-list__scroll.is-dragging {
  cursor: grabbing;
}
.lx-sec-head {
  display: flex;
  align-items: center;
  height: 28px;
  margin-bottom: 10px;
  padding-left: 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--cc-ink) 14%, transparent);
  font-family: var(--cc-font-ui);
  font-size: calc(10.5px * var(--cc-font-scale));
  font-weight: 600;
  color: var(--cc-ink);
}
.lx-sec-head--next {
  margin-top: 10px;
}
.lx-rows {
  display: flex;
  flex-direction: column;
}
.lx-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 44px;
  padding-left: 16px;
  background: var(--cc-surface);
}
/* 行与行之间的分隔线（从文字区开始，最后一行没有） */
.lx-row:not(.is-last)::after {
  content: "";
  position: absolute;
  left: 60px;
  right: 0;
  bottom: 0;
  height: 1px;
  background: color-mix(in srgb, var(--cc-ink) 14%, transparent);
}
.lx-row--movable.is-shifting {
  transition: transform 0.18s cubic-bezier(0.2, 0, 0, 1);
}
.lx-row.is-dragged {
  z-index: 2;
  border-radius: 6px;
  box-shadow: var(--cc-shadow-e2);
  cursor: grabbing;
}
.lx-row.is-dragged::after {
  display: none;
}
.lx-rank {
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--cc-accent);
  color: #fff;
  font-family: var(--cc-font-mono);
  font-size: calc(11px * var(--cc-font-scale));
  font-weight: 600; /* Theme.mono 默认 semibold */
  line-height: 1;
}
.lx-row__text {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.lx-row__name {
  font-family: var(--cc-font-ui);
  font-size: calc(14px * var(--cc-font-scale));
  font-weight: var(--cc-w-medium, 500);
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lx-row__desc {
  font-family: var(--cc-font-ui);
  font-size: calc(11.5px * var(--cc-font-scale));
  line-height: 1.2;
  color: var(--cc-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.lx-row__moves {
  flex: none;
  display: flex;
  align-items: center;
  gap: 2px;
  margin-right: 0;
}
.lx-chev {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 28px;
  font-size: 13px;
  line-height: 1;
  color: var(--cc-muted);
}
.lx-chev:hover:not(:disabled) {
  color: var(--cc-ink);
}
/* 禁用的 ▲▼ 不变淡：前景色由外层 foregroundStyle(muted) 统一指定，基准图里第一行的 ▲ 与其它行一样深 */

/* —— 按钮行 / 提示 —— */
.lx-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lx-spacer {
  flex: 1 1 0;
}
.lx-hint {
  font-family: var(--cc-font-ui);
  font-size: calc(12.5px * var(--cc-font-scale));
}
.lx-hint--danger {
  color: var(--cc-danger);
}
.lx-hint--warn {
  color: var(--cc-warn);
}
.lx-result {
  margin: 0;
  font-family: var(--cc-font-ui);
  font-size: calc(13px * var(--cc-font-scale));
  line-height: 1.2;
}
.lx-result.is-ok {
  color: var(--cc-ok);
}
.lx-result.is-error {
  color: var(--cc-danger);
}

/* —— 词条维护表单 —— */
.lx-field {
  display: flex;
  align-items: center;
  gap: 8px;
}
.lx-field__label {
  flex: none;
  width: 40px;
  text-align: right;
  font-family: var(--cc-font-ui);
  font-size: calc(13.5px * var(--cc-font-scale));
}
</style>
