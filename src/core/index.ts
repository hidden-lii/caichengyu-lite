// 逻辑层统一导出。视图 / 应用层只从这里 import，不要深入子目录。

// 文本工具
export {
  codePointCount,
  codePointsOf,
  isWhitespaceCodePoint,
  removeAllWhitespace,
  splitWhitespace,
  trimUnicodeWhitespace,
} from "./text";

// 数据模型
export {
  charsEqual,
  cloneChar,
  cloneGuess,
  cloneGuesses,
  cloneMarks,
  createGuess,
  createPositionMarks,
  decodeChar,
  decodeGuess,
  decodePositionMarks,
  emptyPolyMap,
  guessEqual,
  guessesEqual,
  marksEqual,
} from "./model/types";
export type {
  CharData,
  DeduceGuess,
  IdiomInput,
  MarkState,
  PolyphoneEntry,
  PolyphoneMap,
  PolyphoneReading,
  PositionMarks,
} from "./model/types";

// 拼音
export {
  buildChars,
  charsFromWordPinyin,
  charsToDigitPinyin,
  charsToMarkedPinyin,
  formatPinyinAsDigit,
  initials,
  markSyllable,
  normalizePinyinInput,
  parseSyllable,
  splitInitial,
  stripTone,
  toneDigit,
  toneLabel,
} from "./pinyin/pinyin";
export {
  buildPolyphoneMap,
  charOwnsPronunciation,
  charsToDisplayPinyin,
  formatReading,
  formatReadingDigit,
  isAutoPronunciationAttr,
  parseReading,
  pickReading,
  pronunciationAttrs,
  readingKey,
  readingsForChar,
  setAutoPronunciationAttr,
  syncPronunciationMarksForChar,
} from "./pinyin/polyphone";
export type { PronunciationAttr } from "./pinyin/polyphone";

// 词库
export { IdiomTable, IdiomTableBuilder, IdiomTableError, ReadingFlag } from "./lexicon/idiomTable";
export { LexiconBaker, LexiconCatalog, LexiconEdits, LexiconMerger } from "./lexicon/catalog";
export type { BakeStats, BuiltinLexicon, LexiconEdit, LexiconEditKind, MergeOutput } from "./lexicon/catalog";
export { createPlatformDataIO } from "./lexicon/dataIO";
export type { DataIO } from "./lexicon/dataIO";
export { LexiconStore } from "./lexicon/store";
export type { LexiconStoreOptions } from "./lexicon/store";
export { LexiconSnapshot, LexiconStoreError, createOutcome, outcomeChanged } from "./lexicon/types";
export type {
  LexiconProgress,
  LexiconStoreCounters,
  LoadReport,
  MutationResult,
  UpsertOutcome,
} from "./lexicon/types";

// 引擎
export { DeduceEngine } from "./engine/engine";
export type {
  DeduceCandidate,
  DeduceFilterOptions,
  DeduceFilterResult,
  DeduceMatchingOptions,
  DeduceScanResult,
} from "./engine/engine";
export { mergeDeduceConstraints } from "./engine/constraints";
export type { DeduceMerged } from "./engine/constraints";
export { DeducePlan } from "./engine/plan";

// 会话
export { DeduceSession, defaultDeduceFilterRunner } from "./session/session";
export type {
  DeduceFilterOutcome,
  DeduceFilterRequest,
  DeduceFilterRunner,
  DeduceSessionOptions,
  DeduceSessionState,
} from "./session/session";
export {
  draftTarget,
  historyTarget,
  markAttrs,
  persistDialogCancelTitle,
  persistDialogConfirmTitle,
  persistDialogPrompt,
  persistDialogTitle,
} from "./session/types";
export type {
  ComboKind,
  DeduceLexicon,
  DeduceMessage,
  DeduceMessageKind,
  DeduceResultItem,
  MarkAttr,
  MarkTarget,
  PersistDialog,
  PersistMode,
  PersistOutcome,
  PersistRequest,
  RestartRequest,
} from "./session/types";
export { MarkGestureRecognizer } from "./session/markGesture";
export type { MarkGesture, MarkGestureModifiers, MouseButtonKind } from "./session/markGesture";
export { mutateMark, setComboKindOnMarks, syncComboPresentDisplay } from "./session/markEditor";
export type { MarkAction } from "./session/markEditor";
