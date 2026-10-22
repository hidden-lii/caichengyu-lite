// 「猜成语」面板的状态与交互逻辑（与 UI 无关）。对应 Swift `Session/DeduceSession*.swift`。
//
// 对应桌面 `src/components/DeducePanel.vue` 的 `<script setup>`（OCR / 调试串部分除外）：
// 视图只负责渲染这里的状态、把用户手势翻译成方法调用。
//
// 所有可观察状态都放在一个 Vue `reactive()` 对象 `session.state` 里，方法内一律读写 `this.state.xxx`
// （不用 `#private`，也不把状态散在类字段里），这样异步回调（筛选完成、写库完成）里改状态同样触发 Vue 更新。
// 视图可以直接 `v-model` 绑定 `state.wordInput` / `state.pinyinInput` / `state.showDetailPanel` 等简单字段；
// 需要副作用的动作一律走方法（`loadWord`、`commitGuess`、`toggleMark` …）。
//
// 单线程模型：筛选是「去抖 32ms → 分块扫描（每片约 8ms 让出一次事件循环）→ 发布」，新请求会取消旧请求。
//
// 按功能分段：
// · 输入区 / 派生状态
// · 加载词、读音编辑、写库确认、确认 / 编辑 / 删除 / 清空
// · 标记手势
// · 筛选流水线、候选选中、复制全部

import { markRaw, reactive, watch } from "vue";
import { DeduceEngine } from "../engine/engine";
import type { IdiomTable } from "../lexicon/idiomTable";
import { ReadingFlag } from "../lexicon/idiomTable";
import {
  cloneGuess,
  cloneGuesses,
  cloneMarks,
  createGuess,
  guessesEqual,
  type CharData,
  type DeduceGuess,
  type PositionMarks,
} from "../model/types";
import {
  charsFromWordPinyin,
  charsToDigitPinyin,
  charsToMarkedPinyin,
  formatPinyinAsDigit,
  normalizePinyinInput,
  parseSyllable,
  toneDigit,
  toneLabel,
} from "../pinyin/pinyin";
import { charsToDisplayPinyin, formatReadingDigit, readingsForChar } from "../pinyin/polyphone";
import { removeAllWhitespace, trimUnicodeWhitespace } from "../text";
import { mutateMark, setComboKindOnMarks, type MarkAction } from "./markEditor";
import type {
  ComboKind,
  DeduceLexicon,
  DeduceMessage,
  DeduceMessageKind,
  DeduceResultItem,
  MarkAttr,
  MarkTarget,
  PersistDialog,
  PersistOutcome,
  PersistRequest,
  RestartRequest,
} from "./types";
import type { MarkState } from "../model/types";

// MARK: - 筛选执行体

/** 一次筛选的全部输入（值快照，筛选期间不会被会话后续改动影响）。 */
export interface DeduceFilterRequest {
  table: IdiomTable;
  guesses: DeduceGuess[];
  polyMap: DeduceLexicon["polyMap"];
  limit: number;
  includePolyphones: boolean;
}

export interface DeduceFilterOutcome {
  items: DeduceResultItem[];
  total: number;
}

/** 执行一次筛选。返回 null 表示被取消；抛错会显示在 `state.error`。 */
export type DeduceFilterRunner = (
  request: DeduceFilterRequest,
  isCancelled: () => boolean,
) => Promise<DeduceFilterOutcome | null> | DeduceFilterOutcome | null;

/** 默认执行体：分块调用引擎（每片让出事件循环），并把候选转成展示用的带调拼音。 */
export const defaultDeduceFilterRunner: DeduceFilterRunner = async (request, isCancelled) => {
  const result = await DeduceEngine.filterAsync({
    table: request.table,
    guesses: request.guesses,
    polyMap: request.polyMap,
    limit: request.limit,
    includePolyphones: request.includePolyphones,
    isCancelled,
  });
  if (result === null) return null;
  const items: DeduceResultItem[] = result.items.map((c) => ({
    row: c.row,
    word: c.word,
    pinyin: charsToDisplayPinyin(c.chars, request.polyMap),
    chars: c.chars,
  }));
  return { items, total: result.total };
};

/** 取消标志。 */
class CancelToken {
  isCancelled = false;
  cancel(): void {
    this.isCancelled = true;
  }
}

// MARK: - 状态

export interface DeduceSessionState {
  // —— 输入区 ——
  /** 顶部「已猜成语」输入框 */
  wordInput: string;
  /** 整段拼音输入框（词库未收录时手填；有草稿时同步为数字调拼音） */
  pinyinInput: string;
  /** 是否显示整段拼音输入栏（视图仅在「无草稿」时才真正展示，见 `pinyinBarVisible`） */
  showPinyinBar: boolean;
  /** 「详细」标记弹层是否打开 */
  showDetailPanel: boolean;
  /** 「清空全部」确认框是否打开 */
  clearConfirmOpen: boolean;
  /** 待确认的「以此词重新开始」；null 表示确认框未打开 */
  restartRequest: RestartRequest | null;

  // —— 猜测 ——
  /** 已记录的猜测 */
  guesses: DeduceGuess[];
  /** 标记台上正在编辑的草稿（`editIndex !== null` 表示正在修改某条已记录猜测） */
  draft: DeduceGuess | null;
  /** 草稿读音基线（数字调拼音）。当前读音与它不同即视为有未应用的读音改动。 */
  draftBaseline: string;
  /** 顶部提示文案；null 表示无提示 */
  message: DeduceMessage | null;
  /** 已记录猜测的展开状态（键为下标） */
  historyExpanded: Record<number, boolean>;
  /** 待确认的写库对话框 */
  persistDialog: PersistDialog | null;
  /** 写库进行中的提示文案；null 表示未在写库 */
  lexiconBusyText: string | null;
  /** 每次选中候选 / 重新开始加一，视图可据此做标记台闪烁提示 */
  stageFlashTick: number;

  // —— 筛选结果 ——
  items: DeduceResultItem[];
  /** 全部匹配数（`items` 最多 `resultLimit` 条） */
  total: number;
  busy: boolean;
  /** 筛选失败的原因；null 表示没有错误 */
  error: string | null;

  // —— 设置 / 词库 ——
  /** 开启后始终用多音字表参与筛选；关闭时仅在无候选时保底展开。变化会重新筛选。 */
  includePolyphones: boolean;
  /** 当前词库快照。整体替换会触发重新筛选；已记录猜测里的 `chars` 不受影响。（已 markRaw，不会被深度代理） */
  lexicon: DeduceLexicon;
}

export interface DeduceSessionOptions {
  /** 词库快照 */
  lexicon: DeduceLexicon;
  /** 写库回调（新增 / 更新读音）。成功后宿主应换上新的 `lexicon`。 */
  persist: (request: PersistRequest) => Promise<PersistOutcome>;
  /** 状态变化到开始筛选的去抖毫秒数，默认 32 */
  debounceMs?: number;
  /** 单调时钟（秒），用于左右键同按后的抑制窗口；测试可注入假时钟 */
  uptime?: () => number;
  /** 测试用：替换筛选执行体（计数、阻塞、制造失败） */
  runner?: DeduceFilterRunner;
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class DeduceSession {
  /** 候选最多显示条数（桌面 `RESULT_LIMIT`） */
  static readonly resultLimit = 200;
  /** 状态变化到真正开始筛选之间的去抖时间（毫秒） */
  static readonly defaultFilterDebounceMs = 32;
  /** 左右键同按之后忽略后续 click / contextmenu 的时长（秒） */
  static readonly markSuppressInterval = 0.4;

  /** 「清空全部」确认框文案（与桌面一致） */
  static readonly clearConfirmTitle = "清空全部条件？";
  static readonly clearConfirmBody = "已录入的猜测与标记将全部清除，此操作不可撤销。";
  static readonly clearConfirmActionTitle = "确认清空";
  static readonly clearCancelTitle = "取消";

  /** 「以此词重新开始」确认框文案 */
  static readonly restartConfirmTitle = "清空后重新开始？";
  static readonly restartConfirmActionTitle = "清空并重新开始";
  static restartConfirmBody(request: RestartRequest): string {
    return (
      `将清除全部 ${request.guessCount} 条已记录猜测、标记台上正在编辑的内容与筛选结果，` +
      `并以「${request.word}」作为第一个词重新标记，此操作不可撤销。`
    );
  }

  /** 组合节点的标签：`组调` / `组` */
  static comboNodeLabel(marks: PositionMarks | null | undefined): string {
    if (marks && marks.combo === "present" && marks.comboTone) return "组调";
    return "组";
  }

  /** 全部可观察状态（Vue `reactive`）。 */
  readonly state: DeduceSessionState;

  private readonly persistFn: (request: PersistRequest) => Promise<PersistOutcome>;
  private readonly filterDebounceMs: number;
  private readonly uptime: () => number;
  private readonly runner: DeduceFilterRunner;
  /** 左右键同按后，此时刻（`uptime` 时钟）之前忽略 click / contextmenu */
  private suppressMarkUntil = 0;
  /** 最近一次提交筛选时的有效猜测，用来跳过「没有实际变化」的重复筛选 */
  private lastRequestedGuesses: DeduceGuess[] | null = null;
  private filterGeneration = 0;
  private filterTask: Promise<void> | null = null;
  private filterToken: CancelToken | null = null;
  private readonly stopWatchers: (() => void)[] = [];

  constructor(options: DeduceSessionOptions) {
    this.persistFn = options.persist;
    this.filterDebounceMs = options.debounceMs ?? DeduceSession.defaultFilterDebounceMs;
    this.uptime = options.uptime ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000);
    this.runner = options.runner ?? defaultDeduceFilterRunner;
    this.state = reactive({
      wordInput: "",
      pinyinInput: "",
      showPinyinBar: false,
      showDetailPanel: false,
      clearConfirmOpen: false,
      restartRequest: null,
      guesses: [],
      draft: null,
      draftBaseline: "",
      message: null,
      historyExpanded: {},
      persistDialog: null,
      lexiconBusyText: null,
      stageFlashTick: 0,
      items: [],
      total: 0,
      busy: false,
      error: null,
      includePolyphones: false,
      lexicon: markRaw(options.lexicon),
    }) as unknown as DeduceSessionState;

    // 同步 watcher：不管视图是直接改 `state.xxx` 还是调下面的 setter，都会重新筛选
    this.stopWatchers.push(
      watch(
        () => this.state.includePolyphones,
        () => this.scheduleFilter(),
        { flush: "sync" },
      ),
      watch(
        () => this.state.lexicon,
        () => this.scheduleFilter(),
        { flush: "sync" },
      ),
    );
    this.scheduleFilter();
  }

  /** 释放 watcher 并取消进行中的筛选（页面销毁时调用；之后不要再用这个会话）。 */
  dispose(): void {
    for (const stop of this.stopWatchers) stop();
    this.stopWatchers.length = 0;
    this.filterToken?.cancel();
    this.filterGeneration += 1;
  }

  // MARK: - 需要副作用的状态的 getter / setter

  get includePolyphones(): boolean {
    return this.state.includePolyphones;
  }

  /** 变化会重新筛选。 */
  set includePolyphones(v: boolean) {
    this.state.includePolyphones = v;
  }

  get lexicon(): DeduceLexicon {
    return this.state.lexicon;
  }

  /** 整体替换会触发重新筛选。 */
  set lexicon(v: DeduceLexicon) {
    this.state.lexicon = markRaw(v);
  }

  // MARK: - 派生状态

  /** 已记录的猜测 + 有标记的草稿预览（桌面 `getActiveDeduceGuesses`） */
  get activeGuesses(): DeduceGuess[] {
    return DeduceEngine.activeGuesses(this.state.guesses, this.state.draft);
  }

  /** 逐字改过读音、但还没「应用读音」 */
  get pinyinDirty(): boolean {
    const draft = this.state.draft;
    if (!draft || this.state.draftBaseline.length === 0) return false;
    return charsToDigitPinyin(draft.chars) !== this.state.draftBaseline;
  }

  /** 是否有可取消的选择（草稿 / 拼音栏 / 输入框里有字） */
  get hasSelection(): boolean {
    return (
      this.state.draft !== null ||
      this.state.showPinyinBar ||
      trimUnicodeWhitespace(this.state.wordInput).length > 0
    );
  }

  /** 整段拼音输入栏该不该显示：只在词库没收录、还没有草稿时出现（已加载词上不出现） */
  get pinyinBarVisible(): boolean {
    return this.state.showPinyinBar && this.state.draft === null;
  }

  /** 标记台空态：既没有草稿、也没有拼音栏 */
  get isStageEmpty(): boolean {
    return this.state.draft === null && !this.state.showPinyinBar;
  }

  /** 「详细」弹层该不该显示（弹层依附于草稿） */
  get detailPanelVisible(): boolean {
    return this.state.showDetailPanel && this.state.draft !== null;
  }

  /** 当前标记台上的词（候选列表据此高亮） */
  get selectedWord(): string | null {
    return this.state.draft?.word ?? null;
  }

  /** 「确认本条并筛选」按钮可用（有草稿） */
  get canCommit(): boolean {
    return this.state.draft !== null;
  }

  /** 正在修改已记录的某条猜测 */
  get isEditingRecorded(): boolean {
    const draft = this.state.draft;
    return draft !== null && draft.editIndex !== null;
  }

  /** 确认按钮标题 */
  get commitButtonTitle(): string {
    return this.isEditingRecorded ? "更新本条并筛选" : "确认本条并筛选";
  }

  /** 写库进行中 */
  get lexiconBusy(): boolean {
    return this.state.lexiconBusyText !== null;
  }

  /** 结果统计文案（与桌面 `resultsMeta` 一致；无有效猜测时为空串） */
  get resultsMeta(): string {
    const active = this.activeGuesses;
    if (active.length === 0) return "";
    const draftHint =
      this.state.draft !== null && DeduceEngine.guessHasMark(this.state.draft) ? "（含当前编辑预览）" : "";
    const polyHint = this.state.includePolyphones ? "（含多音字）" : "";
    const busyHint = this.state.busy ? "…" : "";
    const error = this.state.error;
    if (error !== null && error.length > 0) return `筛选失败：${error}${busyHint}`;
    return `合并 ${active.length} 条猜测后，共 ${this.state.total} 条候选${draftHint}${polyHint}${busyHint}`;
  }

  /** 候选为空时的占位文案 */
  get resultsEmptyText(): string {
    return this.activeGuesses.length === 0 ? "添加猜测并标记后，这里显示符合条件的成语" : "无匹配成语，请检查标记是否矛盾";
  }

  /** 超出显示上限的条数 */
  get hiddenResultCount(): number {
    return Math.max(0, this.state.total - DeduceSession.resultLimit);
  }

  /** 「… 另有 N 条未显示」；没有超出时为 null */
  get resultsMoreText(): string | null {
    const hidden = this.hiddenResultCount;
    return hidden > 0 ? `… 另有 ${hidden} 条未显示` : null;
  }

  /** 是否仍处在左右键同按后的抑制窗口内 */
  get isMarkGestureSuppressed(): boolean {
    return this.uptime() < this.suppressMarkUntil;
  }

  /** 按需读候选释义（不预先全读）。行号越界时返回空串。 */
  explanationForRow(row: number): string {
    const table = this.state.lexicon.table;
    if (!(row >= 0 && row < table.count)) return "";
    return table.explanation(row);
  }

  /** 按候选读释义；词库被替换后行号可能错位，所以先核对词面，对不上就按词面重新查行。 */
  explanation(item: DeduceResultItem): string {
    const table = this.state.lexicon.table;
    if (item.row >= 0 && item.row < table.count && table.word(item.row) === item.word) {
      return table.explanation(item.row);
    }
    const row = table.rowForWord(item.word);
    if (row === null) return "";
    return table.explanation(row);
  }

  // MARK: - 内部工具

  /** 对应桌面 `setMsg`；空文案清除提示。 */
  setMsg(text: string, kind: DeduceMessageKind = "ok"): void {
    this.state.message = text.length === 0 ? null : { text, kind };
  }

  /** 对应桌面 `.trim().replace(/\s/g, '')`：去掉成语里的全部空白。 */
  private cleanWord(s: string): string {
    return removeAllWhitespace(s);
  }

  /** 词库里该词的有效读音；词不存在或读音无效 / 为空都当作「未收录」。 */
  private lookup(word: string): { row: number; chars: CharData[]; pinyin: string } | null {
    const table = this.state.lexicon.table;
    const row = table.rowForWord(word);
    if (row === null || table.flag(row) !== ReadingFlag.valid) return null;
    const chars = table.chars(row);
    if (chars.length === 0) return null;
    return { row, chars, pinyin: charsToMarkedPinyin(chars) };
  }

  /** 记录草稿读音的基线，用于判断是否出现「应用读音」 */
  private markDraftPinyinApplied(): void {
    const draft = this.state.draft;
    this.state.draftBaseline = draft ? charsToDigitPinyin(draft.chars) : "";
  }

  /** 把词库里的读音作为数字调拼音填进拼音栏（空则退回逐字读音）。 */
  private digitPinyinOf(pinyin: string, chars: readonly CharData[]): string {
    const digit = formatPinyinAsDigit(pinyin);
    return digit.length === 0 ? charsToDigitPinyin(chars) : digit;
  }

  // MARK: - 加载

  /**
   * 加载一个已猜成语到标记台（桌面 `loadWord`）。`wordOverride` 为空时取 `state.wordInput`。
   *
   * · 当前草稿就是该词：保留已选标记，只回填拼音栏
   * · 当前草稿已有标记：先把它提交为一条猜测，再加载新词
   * · 该词已在已记录猜测里：进入「修改该条」
   * · 词库收录：载入词库读音与空标记；未收录：显示拼音栏等用户手填
   */
  loadWord(wordOverride?: string | null): void {
    try {
      const word = this.cleanWord(wordOverride ?? this.state.wordInput);
      this.state.wordInput = word;
      this.setMsg("");
      this.state.showPinyinBar = false;
      if (word.length === 0) {
        this.setMsg("请输入成语", "err");
        return;
      }
      const d = this.state.draft;
      if (d !== null && d.word === word) {
        this.state.showPinyinBar = true;
        this.state.pinyinInput = this.digitPinyinOf(d.pinyin, d.chars);
        return;
      }
      if (d !== null && DeduceEngine.guessHasMark(d)) {
        if (!this.commitGuess()) return;
        this.state.wordInput = word;
      }
      const idx = this.state.guesses.findIndex((g) => g.word === word);
      if (idx >= 0) {
        this.editGuess(idx);
        return;
      }
      const found = this.lookup(word);
      if (found !== null) {
        this.state.draft = createGuess({
          word,
          pinyin: found.pinyin,
          chars: found.chars,
          marks: DeduceEngine.createEmptyMarks(found.chars.length),
        });
        this.state.showPinyinBar = true;
        this.state.pinyinInput = formatPinyinAsDigit(found.pinyin);
        this.markDraftPinyinApplied();
        this.setMsg("已加载词库读音，如有误可直接改单字读音", "warn");
        return;
      }
      this.state.draft = null;
      this.state.draftBaseline = "";
      this.state.showPinyinBar = true;
      this.state.pinyinInput = "";
      this.setMsg(`词库中未找到「${word}」，请填写拼音`, "warn");
    } finally {
      this.refilterIfNeeded();
    }
  }

  /** 拼音栏的「应用」：按 `pinyinInput` 生成（或更新）草稿读音，并询问是否写库（桌面 `applyPinyin`）。 */
  applyPinyin(): void {
    try {
      const word = this.state.draft?.word ?? this.cleanWord(this.state.wordInput);
      const pinyin = trimUnicodeWhitespace(this.state.pinyinInput);
      if (word.length === 0) {
        this.setMsg("请先输入成语", "err");
        return;
      }
      const chars = charsFromWordPinyin(word, pinyin);
      if (chars === null) {
        this.setMsg("拼音音节数与字数不一致", "err");
        return;
      }
      const oldDraft = this.state.draft;
      const marks = oldDraft ? oldDraft.marks.map(cloneMarks) : DeduceEngine.createEmptyMarks(chars.length);
      const editIndex = oldDraft?.editIndex ?? null;
      const normalized = normalizePinyinInput(pinyin);
      this.state.draft = createGuess({ word, pinyin: normalized, chars, marks, editIndex });
      this.markDraftPinyinApplied();
      this.setMsg(
        editIndex !== null
          ? "读音已应用，可继续改标记后点「更新本条并筛选」"
          : "读音已应用，请标记后点「确认本条并筛选」",
        "ok",
      );
      this.askPersistPinyin(word, normalized);
    } finally {
      this.refilterIfNeeded();
    }
  }

  // MARK: - 读音编辑

  /** 把逐字改过的读音正式应用到草稿，并询问是否写库（桌面 `applyDraftPinyin`，「应用读音」按钮）。 */
  applyDraftPinyin(): void {
    const draft = this.state.draft;
    if (draft === null) return;
    const d = cloneGuess(draft);
    const digit = charsToDigitPinyin(d.chars);
    const normalized = normalizePinyinInput(digit);
    d.pinyin = normalized;
    this.state.draft = d;
    this.state.pinyinInput = digit;
    this.markDraftPinyinApplied();
    this.setMsg(`读音已应用为 ${digit}`, "ok");
    this.askPersistPinyin(d.word, normalized);
    this.refilterIfNeeded();
  }

  /** 逐字读音编辑（草稿）：`raw` 形如 `jian4` / `xián`（桌面 `onSyllableEdit`）。 */
  editDraftSyllable(pos: number, raw: string): void {
    const draft = this.state.draft;
    if (draft === null) return;
    const d = cloneGuess(draft);
    const label = this.applySyllableEdit(d.chars, pos, raw);
    if (label === null) return;
    const digit = charsToDigitPinyin(d.chars);
    this.state.pinyinInput = digit;
    d.pinyin = normalizePinyinInput(digit);
    this.state.draft = d;
    this.setMsg(`第 ${pos + 1} 字读音已改为 ${label}，可点右下角「应用读音」写入词库`, "ok");
    this.refilterIfNeeded();
  }

  /** 逐字读音编辑（已记录的第 `idx` 条；桌面 `onHistorySyllableEdit`）。改完立即询问是否写库。 */
  editHistorySyllable(idx: number, pos: number, raw: string): void {
    if (!this.hasGuess(idx)) return;
    const g = cloneGuess(this.state.guesses[idx]);
    const label = this.applySyllableEdit(g.chars, pos, raw);
    if (label === null) return;
    const digit = charsToDigitPinyin(g.chars);
    g.pinyin = normalizePinyinInput(digit);
    this.state.guesses[idx] = g;
    const draft = this.state.draft;
    if (draft !== null && draft.editIndex === idx) {
      const d = cloneGuess(draft);
      d.chars = g.chars.map((c) => ({ ...c }));
      d.pinyin = g.pinyin;
      this.state.draft = d;
      this.state.pinyinInput = digit;
    }
    this.setMsg(`「${g.word}」第 ${pos + 1} 字读音已改为 ${label}`, "ok");
    this.askPersistPinyin(g.word, g.pinyin);
    this.refilterIfNeeded();
  }

  /** 多音字：这个字位可选的全部读音（默认位读音在前）。 */
  polyReadings(ch: CharData): CharData[] {
    return readingsForChar(ch, this.state.lexicon.polyMap);
  }

  isPolyphone(ch: CharData): boolean {
    return this.polyReadings(ch).length > 1;
  }

  /** 多音字读音选择（草稿）：等价于把该字读音改成 `formatReadingDigit(reading)`。 */
  chooseDraftReading(pos: number, reading: CharData): void {
    this.editDraftSyllable(pos, formatReadingDigit(reading));
  }

  /** 多音字读音选择（已记录猜测）。 */
  chooseHistoryReading(idx: number, pos: number, reading: CharData): void {
    this.editHistorySyllable(idx, pos, formatReadingDigit(reading));
  }

  /** 「详细」弹层里的声调下拉：`tone` 为 1...5（5 = 轻）。桌面 `setTone`。 */
  setDraftTone(pos: number, tone: number): void {
    const draft = this.state.draft;
    if (draft === null || !(pos >= 0 && pos < draft.chars.length) || !(tone >= 1 && tone <= 5)) return;
    const d = cloneGuess(draft);
    d.chars[pos].tone = tone;
    const digit = charsToDigitPinyin(d.chars);
    this.state.pinyinInput = digit;
    d.pinyin = normalizePinyinInput(digit);
    this.state.draft = d;
    this.setMsg(`第 ${pos + 1} 字声调已改为 ${toneLabel(tone)}，可点「应用读音」写入词库`, "ok");
    this.refilterIfNeeded();
  }

  /** 对应桌面 `applySyllableEdit`：改 `chars[pos]`，成功返回 `py + 声调数字`；失败（含空串）返回 null。 */
  private applySyllableEdit(chars: CharData[], pos: number, raw: string): string | null {
    if (!(pos >= 0 && pos < chars.length)) return null;
    const trimmed = trimUnicodeWhitespace(raw);
    if (trimmed.length === 0) return null;
    const parsed = parseSyllable(trimmed);
    if (parsed.py.length === 0) {
      this.setMsg("无法解析读音，请使用如 jian4 / xián 格式", "err");
      return null;
    }
    chars[pos].py = parsed.py;
    chars[pos].sm = parsed.sm;
    chars[pos].ym = parsed.ym;
    chars[pos].tone = parsed.tone;
    return `${parsed.py}${toneDigit(parsed.tone)}`;
  }

  // MARK: - 写库确认

  /**
   * 读音改过之后问是否写库（桌面 `askPersistPinyin`）：
   * 词库没有 → 新增；读音不同 → 更新；相同 → 提示无需更新。
   */
  askPersistPinyin(word: string, pinyin: string): void {
    const formatted = formatPinyinAsDigit(pinyin);
    const digit = formatted.length === 0 ? pinyin : formatted;
    const found = this.lookup(word);
    if (found === null) {
      this.state.persistDialog = { mode: "add", word, pinyin, digit, oldDigit: null };
      this.setMsg(`读音已改成 ${digit}，请确认是否写入词库`, "warn");
      return;
    }
    const oldDigit = formatPinyinAsDigit(found.pinyin);
    if (oldDigit === digit) {
      this.setMsg(`读音 ${digit} 与词库一致，无需更新`, "ok");
      return;
    }
    this.state.persistDialog = { mode: "update", word, pinyin, digit, oldDigit };
    this.setMsg(`读音已从 ${oldDigit} 改为 ${digit}，请确认是否更新词库`, "warn");
  }

  /** 「只改展示，不写库」 */
  cancelPersistPinyin(): void {
    this.state.persistDialog = null;
    this.setMsg("已仅更新当前展示，未改词库", "warn");
  }

  /**
   * 「写入词库 / 更新词库」：走注入的 `persist` 回调。
   * 成功后宿主应已换上新词库（`lexicon` 被重新赋值，由它触发重新筛选）。
   */
  async confirmPersistPinyin(): Promise<void> {
    const dialog = this.state.persistDialog;
    if (dialog === null) return;
    const snapshot: PersistDialog = { ...dialog };
    this.state.persistDialog = null;
    this.state.lexiconBusyText = snapshot.mode === "add" ? "正在写入词库…" : "正在更新词库读音…";
    let outcome: PersistOutcome;
    try {
      outcome = await this.persistFn({ word: snapshot.word, pinyin: snapshot.pinyin, mode: snapshot.mode });
    } catch (e) {
      outcome = { ok: false, message: errorText(e) };
    }
    this.state.lexiconBusyText = null;
    if (outcome.ok) {
      this.setMsg(
        snapshot.mode === "add"
          ? `已新增「${snapshot.word}」到词库（${snapshot.digit}）`
          : `已更新词库「${snapshot.word}」读音为 ${snapshot.digit}`,
        "ok",
      );
    } else {
      // 桌面：新增失败为 err，更新「未更新」为 warn
      const fallback = snapshot.mode === "add" ? "写入词库失败" : "更新词库失败";
      this.setMsg(outcome.message.length === 0 ? fallback : outcome.message, snapshot.mode === "add" ? "err" : "warn");
    }
  }

  // MARK: - 确认 / 编辑 / 删除

  private hasGuess(idx: number): boolean {
    return Number.isInteger(idx) && idx >= 0 && idx < this.state.guesses.length;
  }

  /**
   * 把草稿提交为一条已记录猜测（桌面 `commitGuess`）。成功返回 true。
   * 有 `editIndex` 则替换那一条，否则同词面替换（先删旧的再追加）或直接追加。
   */
  commitGuess(): boolean {
    try {
      const draft = this.state.draft;
      if (draft === null) return false;
      const d = cloneGuess(draft);
      if (trimUnicodeWhitespace(this.state.pinyinInput).length > 0) {
        const chars = charsFromWordPinyin(d.word, this.state.pinyinInput);
        if (chars === null) {
          this.setMsg("拼音音节数与字数不一致，请先修正读音", "err");
          return false;
        }
        d.chars = chars;
        d.pinyin = normalizePinyinInput(this.state.pinyinInput);
      }
      const payload = createGuess({
        word: d.word,
        pinyin: d.pinyin,
        chars: d.chars,
        marks: DeduceEngine.finalizeMarks(d.marks),
      });
      const editIndex = d.editIndex;
      if (editIndex !== null && this.hasGuess(editIndex)) {
        this.state.guesses[editIndex] = payload;
      } else {
        const existing = this.state.guesses.findIndex((g) => g.word === payload.word);
        if (existing >= 0) this.removeGuessKeepingState(existing);
        this.state.guesses.push(payload);
      }
      this.state.draft = null;
      this.state.draftBaseline = "";
      this.state.wordInput = "";
      this.state.showPinyinBar = false;
      this.state.showDetailPanel = false;
      this.setMsg(editIndex !== null ? "已更新筛选条件" : "已加入筛选条件", "ok");
      return true;
    } finally {
      this.refilterIfNeeded();
    }
  }

  /** 载入已记录的第 `idx` 条到标记台修改（桌面 `editGuess`）。 */
  editGuess(idx: number): void {
    if (!this.hasGuess(idx)) return;
    const g = this.state.guesses[idx];
    this.state.draft = createGuess({
      word: g.word,
      pinyin: g.pinyin,
      chars: g.chars.map((c) => ({ ...c })),
      marks: g.marks.map(cloneMarks),
      editIndex: idx,
    });
    this.state.wordInput = g.word;
    this.state.showPinyinBar = true;
    this.state.pinyinInput = this.digitPinyinOf(g.pinyin, g.chars);
    this.markDraftPinyinApplied();
    this.setMsg("正在修改该条：可改标记后点「更新本条并筛选」；读音也可在下方记录里直接改", "warn");
    this.refilterIfNeeded();
  }

  /**
   * 删除已记录的第 `idx` 条（桌面 `removeGuess`）。
   *
   * 与桌面的差异：同时修正按下标记录的状态——展开状态跟着下移；正在修改的草稿若指向被删的那条则转为新增，
   * 指向其后的条目则下标减一（桌面不处理，删除之后再「更新本条」会改错条目）。
   */
  removeGuess(idx: number): void {
    if (!this.hasGuess(idx)) return;
    this.removeGuessKeepingState(idx);
    this.refilterIfNeeded();
  }

  /** 删除第 `idx` 条并修正下标相关状态（不触发筛选，由调用方负责）。 */
  private removeGuessKeepingState(idx: number): void {
    this.state.guesses.splice(idx, 1);
    const shifted: Record<number, boolean> = {};
    for (const key of Object.keys(this.state.historyExpanded)) {
      const k = Number(key);
      const v = this.state.historyExpanded[k];
      if (k < idx) shifted[k] = v;
      else if (k > idx) shifted[k - 1] = v;
    }
    this.state.historyExpanded = shifted;
    const draft = this.state.draft;
    if (draft !== null && draft.editIndex !== null) {
      const d = cloneGuess(draft);
      if (draft.editIndex === idx) d.editIndex = null;
      else if (draft.editIndex > idx) d.editIndex = draft.editIndex - 1;
      this.state.draft = d;
    }
  }

  // MARK: - 展开 / 取消 / 清空

  isHistoryExpanded(idx: number): boolean {
    return this.state.historyExpanded[idx] ?? false;
  }

  toggleHistoryExpanded(idx: number): void {
    this.state.historyExpanded = { ...this.state.historyExpanded, [idx]: !(this.state.historyExpanded[idx] ?? false) };
  }

  /** 取消当前选中的词与其全部标记；已记录的猜测与筛选结果不受影响（桌面 `clearSelection`）。 */
  clearSelection(): void {
    this.state.draft = null;
    this.state.draftBaseline = "";
    this.state.wordInput = "";
    this.state.pinyinInput = "";
    this.state.showPinyinBar = false;
    this.state.showDetailPanel = false;
    this.setMsg("已取消当前选择，已记录的猜测保持不变", "warn");
    this.refilterIfNeeded();
  }

  /** 「清空全部」入口：有内容先弹确认框，没内容直接清（桌面 `requestClearAll`）。 */
  requestClearAll(): void {
    const hasContent =
      this.state.guesses.length > 0 ||
      this.state.draft !== null ||
      trimUnicodeWhitespace(this.state.wordInput).length > 0;
    if (!hasContent) {
      this.clearAll();
      return;
    }
    this.state.clearConfirmOpen = true;
  }

  cancelClearAll(): void {
    this.state.clearConfirmOpen = false;
  }

  confirmClearAll(): void {
    this.state.clearConfirmOpen = false;
    this.clearAll();
  }

  // MARK: - 以已记录的某个词重新开始一轮

  /**
   * 「重新开始」入口：一轮猜完后，从已记录里点某个词，清空全部再以它为第一个词重新标记。
   * 会丢掉当前这一轮的全部进度，所以先弹确认框（`state.restartRequest` 非 null）。
   */
  requestRestart(idx: number): void {
    if (!this.hasGuess(idx)) return;
    this.state.restartRequest = { index: idx, word: this.state.guesses[idx].word, guessCount: this.state.guesses.length };
  }

  cancelRestart(): void {
    this.state.restartRequest = null;
  }

  /**
   * 用户点了确认：清空并以该词重新开始，返回要复制到剪贴板的词面（与 `selectCandidate` 同一套约定）。
   * 没有待确认的请求、或词面对不上（什么都没清）返回 null，此时不要复制。复制失败请调用 `reportRestartCopyFailed`。
   */
  confirmRestart(): string | null {
    const request = this.state.restartRequest;
    if (request === null) return null;
    const req: RestartRequest = { ...request };
    this.state.restartRequest = null;
    // 确认框开着期间记录没有变动；仍核对一次词面，防止下标错位后清掉不该清的东西
    if (!this.hasGuess(req.index) || this.state.guesses[req.index].word !== req.word) return null;
    if (!this.restart(req.index)) return null;
    this.setMsg(`已清空，以「${req.word}」重新开始并已复制，请重新标记`, "ok");
    return req.word;
  }

  /** 视图复制剪贴板失败时调用，改写提示。 */
  reportRestartCopyFailed(word: string): void {
    this.setMsg(`已清空，以「${word}」重新开始，复制失败`, "warn");
  }

  /**
   * 清空全部已记录猜测、草稿与筛选结果，再把已记录的第 `idx` 条词载入标记台，标记全部留空。
   * 效果等同「清空全部」后重新输入这个词，区别是沿用该条已记录的读音（逐字改过的多音字、词库未收录的词不会丢）。
   * 不弹确认框，调用方负责先确认。成功返回 true。
   */
  restart(idx: number): boolean {
    try {
      if (!this.hasGuess(idx)) return false;
      const g = cloneGuess(this.state.guesses[idx]);
      this.state.restartRequest = null;
      this.state.guesses = [];
      this.state.historyExpanded = {};
      this.state.showDetailPanel = false;
      this.state.draft = createGuess({
        word: g.word,
        pinyin: g.pinyin,
        chars: g.chars,
        marks: DeduceEngine.createEmptyMarks(g.chars.length),
      });
      this.state.wordInput = g.word;
      this.state.showPinyinBar = true;
      this.state.pinyinInput = this.digitPinyinOf(g.pinyin, g.chars);
      this.markDraftPinyinApplied();
      this.setMsg(`已清空，以「${g.word}」重新开始，请重新标记`, "ok");
      this.state.stageFlashTick += 1;
      return true;
    } finally {
      this.refilterIfNeeded();
    }
  }

  /** 直接清空全部猜测、草稿与输入（桌面 `clearAll`，不含 OCR 部分）。 */
  clearAll(): void {
    this.state.guesses = [];
    this.state.draft = null;
    this.state.draftBaseline = "";
    this.state.wordInput = "";
    this.state.pinyinInput = "";
    this.state.showPinyinBar = false;
    this.state.showDetailPanel = false;
    this.state.historyExpanded = {};
    this.setMsg("");
    this.refilterIfNeeded();
  }

  // MARK: - 标记手势
  //
  // 手势约定（与桌面一致）：
  // · 左键：对 ↔ 无
  // · 右键：偏；已是偏则变无。组合节点按 组 → 组调 → 无 循环
  // · 左右键同按：清除为未选，并在随后 400ms 内忽略 click / contextmenu，避免再切一次
  // · 字标为对 / 偏时，自动带出声韵调（浅色）；字取消后撤回自动带出的部分

  /** 左键点击：对 ↔ 无（桌面 `toggleNodeMark` / `toggleHistoryMark`）。处于同按抑制窗口内则忽略。 */
  toggleMark(target: MarkTarget, pos: number, attr: MarkAttr): void {
    if (this.isMarkGestureSuppressed) return;
    this.applyMark(target, pos, attr, { kind: "hitToggle" });
  }

  /** 右键点击：偏（已是偏则变无）；组合节点循环 组 → 组调 → 无。处于同按抑制窗口内则忽略。 */
  presentMark(target: MarkTarget, pos: number, attr: MarkAttr): void {
    if (this.isMarkGestureSuppressed) return;
    this.applyMark(target, pos, attr, { kind: "presentToggle" });
  }

  /**
   * 左右键同时按下：清除为未选，并开启 400ms 抑制窗口。
   * 视图在 mousedown 里检测到两个键都按下时调用（桌面 `onDraftMarkPointerDown` / `onHistoryMarkPointerDown`）。
   */
  clearMark(target: MarkTarget, pos: number, attr: MarkAttr): void {
    this.armMarkGestureSuppress();
    this.applyMark(target, pos, attr, { kind: "clear" });
  }

  /**
   * 「详细」弹层里的 对 / 偏 / 无 按钮：直接设某状态，再点同一状态则撤回为未选（桌面 `setMark`）。
   * 不受同按抑制窗口影响。
   */
  setMark(pos: number, attr: MarkAttr, mark: MarkState): void {
    this.applyMark({ kind: "draft" }, pos, attr, { kind: "set", mark });
  }

  /** 「详细」弹层里组合的 组 / 组调 / 无 按钮（桌面 `setComboKind`）。 */
  setComboKind(pos: number, kind: ComboKind): void {
    const draft = this.state.draft;
    if (draft === null || !(pos >= 0 && pos < draft.marks.length)) return;
    const d = cloneGuess(draft);
    setComboKindOnMarks(d.marks[pos], kind);
    this.state.draft = d;
    this.refilterIfNeeded();
  }

  /** 开启抑制窗口（桌面 `armMarkGestureSuppress`）。 */
  armMarkGestureSuppress(): void {
    this.suppressMarkUntil = this.uptime() + DeduceSession.markSuppressInterval;
  }

  /** 对 `target` 的第 `pos` 位做一次标记变换；位置不存在则什么都不做。 */
  private applyMark(target: MarkTarget, pos: number, attr: MarkAttr, action: MarkAction): void {
    switch (target.kind) {
      case "draft": {
        const draft = this.state.draft;
        if (draft === null || !(pos >= 0 && pos < draft.marks.length)) return;
        const d = cloneGuess(draft);
        mutateMark(d.marks[pos], attr, action);
        this.state.draft = d;
        break;
      }
      case "history": {
        const idx = target.index;
        if (!this.hasGuess(idx)) return;
        const original = this.state.guesses[idx];
        if (!(pos >= 0 && pos < original.marks.length)) return;
        const g = cloneGuess(original);
        mutateMark(g.marks[pos], attr, action);
        this.state.guesses[idx] = g;
        // 正在修改这一条时，标记台上的草稿跟着变（桌面 `syncDraftMarksFromGuess`）
        const draft = this.state.draft;
        if (draft !== null && draft.editIndex === idx) {
          const d = cloneGuess(draft);
          d.marks = g.marks.map(cloneMarks);
          this.state.draft = d;
        }
        break;
      }
    }
    this.refilterIfNeeded();
  }

  // MARK: - 筛选流水线
  //
  // 状态变化 → 去抖 → 分块扫描 → 发布。新请求会取消旧请求（引擎每 256 行检查一次取消标志）。
  // 对应桌面 `scheduleRemoteFilter` / `runRemoteFilter`。

  /**
   * 有效猜测相对上次提交筛选没有变化就跳过；变化了才重新调度。
   * 每个会改动 `guesses` / `draft` 的方法在结尾调用（对应桌面对 `activeGuesses` 的深度 watch）。
   */
  refilterIfNeeded(): void {
    const last = this.lastRequestedGuesses;
    if (last !== null && guessesEqual(last, this.activeGuesses)) return;
    this.scheduleFilter();
  }

  /** 取消旧请求，去抖后按当前状态重新筛选。无有效猜测时立即清空结果（桌面要等去抖后才清）。 */
  scheduleFilter(): void {
    this.filterToken?.cancel();
    this.filterGeneration += 1;
    const generation = this.filterGeneration;

    // 值快照：筛选期间状态继续变化也不会影响这次请求，也用来判断「有效猜测有没有变」
    const active = cloneGuesses(this.activeGuesses);
    this.lastRequestedGuesses = active;

    if (active.length === 0) {
      this.filterToken = null;
      this.filterTask = null;
      this.state.items = markRaw([]);
      this.state.total = 0;
      this.state.busy = false;
      this.state.error = null;
      return;
    }

    const token = new CancelToken();
    this.filterToken = token;
    const request: DeduceFilterRequest = {
      table: this.state.lexicon.table,
      guesses: active,
      polyMap: this.state.lexicon.polyMap,
      limit: DeduceSession.resultLimit,
      includePolyphones: this.state.includePolyphones,
    };
    const delay = this.filterDebounceMs;
    this.filterTask = (async () => {
      if (delay > 0) await sleep(delay);
      else await Promise.resolve();
      if (generation !== this.filterGeneration || token.isCancelled) return;
      await this.runFilter(request, token, generation);
    })();
  }

  /** 等到当前挂起的筛选全部结束（去抖 + 运行 + 发布）。测试与需要「筛完再继续」的调用方使用。 */
  async waitForFilter(): Promise<void> {
    while (this.filterTask !== null) {
      const generation = this.filterGeneration;
      await this.filterTask;
      if (generation === this.filterGeneration) {
        // 没有新请求插进来；保险起见清掉已结束的任务引用
        this.filterTask = null;
        return;
      }
    }
  }

  private async runFilter(request: DeduceFilterRequest, token: CancelToken, generation: number): Promise<void> {
    if (generation !== this.filterGeneration || token.isCancelled) return;
    this.state.busy = true;
    this.state.error = null;
    let result: DeduceFilterOutcome | null = null;
    let failure: unknown = null;
    let failed = false;
    try {
      result = await this.runner(request, () => token.isCancelled);
    } catch (e) {
      failed = true;
      failure = e;
    }

    // 期间又来了新请求：结果作废，busy 交给新请求处理（桌面 `seq !== filterSeq`）
    if (generation !== this.filterGeneration || token.isCancelled) return;
    if (failed) {
      this.state.items = markRaw([]);
      this.state.total = 0;
      this.state.error = errorText(failure);
    } else if (result !== null) {
      this.state.items = markRaw(result.items);
      this.state.total = result.total;
      this.state.error = null;
    }
    this.state.busy = false;
    this.filterTask = null;
  }

  // MARK: - 候选选中 / 复制

  /**
   * 选中一个候选：把该词载入标记台，返回要复制到剪贴板的词面（桌面 `onCandidateSelect`）。
   * 载入失败（草稿合并失败等）返回 null，此时不要复制。复制失败请调用 `reportSelectionCopyFailed`。
   */
  selectCandidate(wordOrItem: string | DeduceResultItem): string | null {
    const word = typeof wordOrItem === "string" ? wordOrItem : wordOrItem.word;
    this.loadWord(word);
    if (this.state.draft?.word !== word) return null;
    this.setMsg(`已选中并复制「${word}」`, "ok");
    this.state.stageFlashTick += 1;
    return word;
  }

  /** 视图复制剪贴板失败时调用，改写提示（桌面：`已选中「…」，复制失败`）。 */
  reportSelectionCopyFailed(word: string): void {
    this.setMsg(`已选中「${word}」，复制失败`, "warn");
  }

  /**
   * 复制全部待选：分块算出全部匹配词面（不受 200 条显示上限限制）并返回，由视图 `join("\n")` 后写剪贴板。
   * 没有可复制的内容返回空数组（并提示）。写剪贴板失败请调用 `reportCopyFailed()`。
   */
  async copyAllCandidates(): Promise<string[]> {
    const active = cloneGuesses(this.activeGuesses);
    if (active.length === 0 || this.state.total <= 0) {
      this.setMsg("暂无待选成语可复制", "warn");
      return [];
    }
    const lexicon = this.state.lexicon;
    const words = await DeduceEngine.matchingWordsAsync({
      table: lexicon.table,
      guesses: active,
      polyMap: lexicon.polyMap,
      includePolyphones: this.state.includePolyphones,
    });
    if (words === null) {
      this.setMsg("复制失败", "err");
      return [];
    }
    if (words.length === 0) {
      this.setMsg("暂无待选成语可复制", "warn");
      return [];
    }
    this.setMsg(`已复制 ${words.length} 条待选成语`, "ok");
    return words;
  }

  /** 视图写剪贴板失败时调用。 */
  reportCopyFailed(): void {
    this.setMsg("复制失败", "err");
  }
}
