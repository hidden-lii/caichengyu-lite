// 外观设置的数据层：当前生效的主题与字体、用户的自定义主题、持久化。移植自 ThemeStore.swift 的 `ThemeStore`。
//
// - `palette` / `fonts` 是响应式的：组件读它们，改动后自动刷新。
// - 直接赋值（`previewPalette`）只改内存、不落盘，用于预览；经 `select` / `updateCurrentCustom` 等方法修改才会落盘。
// - 落盘到 `appearance.json`（经 platform 的 readData / writeData），改动后 0.4 秒内合并写一次，页面隐藏 / 关闭时再补一次。

import { computed, shallowRef, type ComputedRef, type ShallowRef } from "vue";
import * as platform from "../platform";
import {
  type FontSettings,
  clampScale,
  decodeFontSettings,
  defaultFonts,
  encodeFontSettings,
  fontSystem,
  fontsEqual,
} from "./fonts";
import {
  type MaterialSeed,
  type Palette,
  clonePalette,
  decodePalette,
  defaultSeed,
  defaultTheme,
  builtinPalettes,
  encodePalette,
  isBuiltin,
  isLegacyID,
  materialID,
  palettesEqual,
  paletteNamed,
  parseMaterialID,
} from "./palette";

/** 设置文件版本：1 = 旧版（桌面版配色，界面文字宋体）；2 = Material（默认「朱砂 · 浅色」，界面文字系统字体）。 */
export const FILE_VERSION = 2;
export const FILE_NAME = "appearance.json";

/** 改动后合并写盘的延迟（毫秒），拖取色器时不会狂写 */
export const SAVE_DELAY_MS = 400;

/** ThemeStore 需要的存储能力（默认走 platform；单测里换成内存实现）。 */
export interface ThemeIO {
  read(name: string): Promise<string | null>;
  write(name: string, contents: string): Promise<void>;
  remove(name: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

export const platformIO: ThemeIO = {
  read: (name) => platform.readData(name),
  write: (name, contents) => platform.writeData(name, contents),
  remove: (name) => platform.removeData(name),
  rename: (from, to) => platform.renameData(from, to),
};

type Json = Record<string, unknown>;

const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

/** 键排序的 JSON（= Swift 的 `.sortedKeys`），两空格缩进 */
function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (isObject(v)) {
      const o: Json = {};
      for (const k of Object.keys(v).sort()) o[k] = sort(v[k]);
      return o;
    }
    return v;
  };
  return JSON.stringify(sort(value), null, 2);
}

function randomID(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  const uuid =
    typeof c?.randomUUID === "function"
      ? c.randomUUID()
      : "xxxxxxxx-xxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
  return uuid.slice(0, 8).toLowerCase();
}

/** 解出来的设置文件内容（解码失败 = 整个文件损坏） */
interface Stored {
  version?: number;
  selected: string;
  fonts?: FontSettings;
  customThemes: (Palette | null)[];
}

function decodeStored(text: string): Stored {
  const raw: unknown = JSON.parse(text);
  if (!isObject(raw)) throw new Error("不是 JSON 对象");
  if (typeof raw.selected !== "string") throw new Error("缺少 selected");
  if (!Array.isArray(raw.customThemes)) throw new Error("缺少 customThemes");
  let version: number | undefined;
  if (raw.version !== undefined && raw.version !== null) {
    if (typeof raw.version !== "number" || !Number.isInteger(raw.version)) throw new Error("version 不是整数");
    version = raw.version;
  }
  let fonts: FontSettings | undefined;
  if (raw.fonts !== undefined && raw.fonts !== null) {
    const f = decodeFontSettings(raw.fonts);
    if (!f) throw new Error("fonts 不是对象");
    fonts = f;
  }
  // 单个自定义主题损坏时只丢它自己，不连累其他主题
  const customThemes = raw.customThemes.map((t) => decodePalette(t));
  return { version, selected: raw.selected, fonts, customThemes };
}

export class ThemeStore {
  /** 当前生效的主题（可能因预览 / `?style=` 与 selectedID 不同） */
  readonly palette: ShallowRef<Palette> = shallowRef(defaultTheme);
  readonly fonts: ShallowRef<FontSettings> = shallowRef(defaultFonts());
  /** 已持久化选中的主题 id */
  readonly selectedID: ShallowRef<string> = shallowRef(defaultTheme.id);
  readonly customThemes: ShallowRef<Palette[]> = shallowRef([]);
  /** 最近一次读 / 写文件时遇到的问题（文件损坏等），设置页可展示；null 表示没问题 */
  readonly loadNote: ShallowRef<string | null> = shallowRef(null);

  readonly allThemes: ComputedRef<Palette[]> = computed(() => [...builtinPalettes, ...this.customThemes.value]);
  readonly selectedIsCustom: ComputedRef<boolean> = computed(() =>
    this.customThemes.value.some((p) => p.id === this.selectedID.value),
  );
  /** 当前是不是 Material 内置主题；是的话返回 (色, 是否深色)。快速外观菜单据此显示选中项。 */
  readonly currentMaterial: ComputedRef<{ seed: MaterialSeed; dark: boolean } | null> = computed(() =>
    parseMaterialID(this.selectedID.value),
  );

  private pendingSave: ReturnType<typeof setTimeout> | null = null;
  private loaded = false;
  private readonly io: ThemeIO;

  constructor(io: ThemeIO = platformIO) {
    this.io = io;
  }

  // MARK: 读写

  /**
   * 读取已保存的外观设置；文件不存在就用默认值（朱砂 · 浅色 + 系统界面字体 + 宋体字头）。
   * 文件损坏：挪成 `appearance.json.bad` 留给用户，本次用默认值，避免下次保存时悄悄覆盖掉。
   */
  async load(): Promise<void> {
    this.loaded = true;
    let text: string | null;
    try {
      text = await this.io.read(FILE_NAME);
    } catch (e) {
      this.loadNote.value = `外观设置读取失败：${String(e)}`;
      return;
    }
    if (text === null) return;
    let stored: Stored;
    try {
      stored = decodeStored(text);
    } catch {
      const bad = FILE_NAME + ".bad";
      try {
        await this.io.remove(bad);
        await this.io.rename(FILE_NAME, bad);
      } catch {
        /* 挪不动也不影响本次使用 */
      }
      this.loadNote.value = `外观设置文件无法读取，已改用默认外观；原文件保留为 ${bad}`;
      return;
    }

    this.customThemes.value = stored.customThemes.filter((p): p is Palette => p !== null && !isBuiltin(p));
    const loadedFonts = stored.fonts ?? defaultFonts();
    let selected = stored.selected;
    // v1 → v2：界面从宋体换成系统字体（字头仍是宋体）；选的是旧内置主题的，换到新默认主题。
    // 自定义主题、以及用户已经改成别的字体的，原样保留。旧主题仍可在「设置 → 外观」里选回来。
    const migrating = (stored.version ?? 1) < FILE_VERSION;
    if (migrating) {
      if (loadedFonts.ui.kind === "songti") loadedFonts.ui = { ...fontSystem };
      if (isLegacyID(selected)) selected = defaultTheme.id;
    }
    this.fonts.value = loadedFonts;
    this.selectedID.value = this.allThemes.value.some((p) => p.id === selected) ? selected : defaultTheme.id;
    this.palette.value = this.allThemes.value.find((p) => p.id === this.selectedID.value) ?? defaultTheme;
    this.loadNote.value = null;
    if (migrating) this.scheduleSave();
  }

  private encode(): string {
    return stableStringify({
      version: FILE_VERSION,
      selected: this.selectedID.value,
      fonts: encodeFontSettings(this.fonts.value),
      customThemes: this.customThemes.value.map(encodePalette),
    });
  }

  /** 立刻写盘（先取消排队中的那次）。`load()` 之前不写，免得把还没读进来的旧设置覆盖掉。 */
  async saveNow(): Promise<void> {
    this.cancelPending();
    if (!this.loaded) return;
    try {
      await this.io.write(FILE_NAME, this.encode());
    } catch (e) {
      this.loadNote.value = `外观设置保存失败：${String(e)}`;
    }
  }

  /** 有待写的改动就立刻写出（页面隐藏 / 关闭时调用） */
  async flush(): Promise<void> {
    if (this.pendingSave !== null) await this.saveNow();
  }

  private cancelPending(): void {
    if (this.pendingSave !== null) {
      clearTimeout(this.pendingSave);
      this.pendingSave = null;
    }
  }

  private scheduleSave(): void {
    if (!this.loaded) return;
    this.cancelPending();
    this.pendingSave = setTimeout(() => {
      this.pendingSave = null;
      void this.saveNow();
    }, SAVE_DELAY_MS);
  }

  // MARK: 主题

  /** 切换主题。`persist: false` 只在本次运行生效（`?style=` 临时覆盖用）。 */
  select(id: string, persist = true): void {
    const p = this.allThemes.value.find((t) => t.id === id);
    if (!p) return;
    this.palette.value = p;
    if (!persist) return;
    this.selectedID.value = id;
    this.scheduleSave();
  }

  /** 只改内存里的生效主题，不改选中项、不落盘（预览、快照用）。 */
  previewPalette(p: Palette): void {
    this.palette.value = p;
  }

  /** 在 Material 主题里换主题色 / 明暗。当前不是 Material 主题时，缺省用默认色 / 当前主题的明暗。 */
  selectMaterial(options: { seed?: MaterialSeed; dark?: boolean } = {}): void {
    const cur = this.currentMaterial.value;
    const seed = options.seed ?? cur?.seed ?? defaultSeed;
    const dark = options.dark ?? cur?.dark ?? this.palette.value.scheme === "dark";
    this.select(materialID(seed.id, dark));
  }

  /** 以当前生效的主题为底复制出一套自定义主题并选中它。 */
  duplicateCurrent(): Palette {
    const cur = this.palette.value;
    const copy = clonePalette(cur);
    copy.id = "custom-" + randomID();
    copy.baseID = isBuiltin(cur) ? cur.id : cur.baseID;
    copy.name = this.uniqueName(cur.name + " 副本");
    copy.tagline = "自定义";
    this.customThemes.value = [...this.customThemes.value, copy];
    this.select(copy.id);
    return copy;
  }

  private uniqueName(base: string): string {
    const taken = new Set(this.allThemes.value.map((p) => p.name));
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base} ${n}`)) n += 1;
    return `${base} ${n}`;
  }

  /** 修改当前选中的自定义主题；选中的是内置主题时什么也不做。 */
  updateCurrentCustom(mutate: (p: Palette) => void): void {
    const i = this.customThemes.value.findIndex((p) => p.id === this.selectedID.value);
    if (i < 0) return;
    const old = this.customThemes.value[i]!;
    const p = clonePalette(old);
    mutate(p);
    p.id = old.id; // id 与来源不允许被改
    p.baseID = old.baseID;
    if (palettesEqual(p, old)) return;
    const next = [...this.customThemes.value];
    next[i] = p;
    this.customThemes.value = next;
    this.palette.value = p;
    this.scheduleSave();
  }

  /** 把当前自定义主题恢复成它所基于的内置主题的样子（保留名称）。 */
  resetCurrentCustomToBase(): void {
    const i = this.customThemes.value.findIndex((p) => p.id === this.selectedID.value);
    if (i < 0) return;
    const cur = this.customThemes.value[i]!;
    const base = paletteNamed(cur.baseID ?? "");
    if (!base) return;
    const p = clonePalette(base);
    p.id = cur.id;
    p.name = cur.name;
    p.tagline = "自定义";
    p.baseID = base.id;
    const next = [...this.customThemes.value];
    next[i] = p;
    this.customThemes.value = next;
    this.palette.value = p;
    this.scheduleSave();
  }

  /** 删除一套自定义主题；删的是正在用的，就回到默认主题。 */
  deleteCustom(id: string): void {
    if (!this.customThemes.value.some((p) => p.id === id)) return;
    this.customThemes.value = this.customThemes.value.filter((p) => p.id !== id);
    if (this.selectedID.value === id) this.select(defaultTheme.id);
    else this.scheduleSave();
  }

  // MARK: 字体

  updateFonts(mutate: (f: FontSettings) => void): void {
    const f: FontSettings = { ui: { ...this.fonts.value.ui }, word: { ...this.fonts.value.word }, scale: this.fonts.value.scale };
    mutate(f);
    f.scale = clampScale(f.scale);
    if (fontsEqual(f, this.fonts.value)) return;
    this.fonts.value = f;
    this.scheduleSave();
  }

  resetFonts(): void {
    this.updateFonts((f) => {
      const d = defaultFonts();
      f.ui = d.ui;
      f.word = d.word;
      f.scale = d.scale;
    });
  }
}
