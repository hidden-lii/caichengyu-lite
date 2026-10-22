// 应用级模型（src/app/model.ts）：加载阶段、状态文案、设置弹层守卫、写库回调接到词库存储。
// 对应 mac 版 `AppModel.swift`（没有对应的 Swift 测试，这里按行为写）。

import { computed, nextTick, watchEffect } from "vue";
import { createAppModel } from "../../src/app/model";
import { LexiconStore } from "../../src/core/lexicon/store";
import { describe, expect, it } from "vitest";
import { FsDataIO } from "./support/fsIO";

function newModel(io = new FsDataIO()) {
  const model = createAppModel({ io, sessionOptions: { debounceMs: 0 } });
  return { model, io };
}

describe("AppModel · 加载", () => {
  it("start：loading → ready，文案随状态变化", async () => {
    const { model, io } = newModel();
    try {
      expect(model.state.phase).toBe("loading");
      expect(model.state.phaseMessage).toBe("正在载入词库…");
      expect(model.statusText).toBe("词库加载中…");
      expect(model.statusChipText).toBe("词库加载中…");
      expect(model.statusIsHealthy).toBe(false);
      expect(model.state.session).toBeNull();

      // getter 读的是 reactive state：computed 会随状态变化
      const chip = computed(() => model.statusChipText);
      const healthy = computed(() => model.statusIsHealthy);
      expect(chip.value).toBe("词库加载中…");

      const progress: string[] = [];
      const stop = watchEffect(
        () => {
          progress.push(model.state.phaseMessage);
        },
        { flush: "sync" },
      );
      const p = model.start();
      expect(model.start(), "重复 start 只执行一次").toBe(p);
      await p;
      stop();

      expect(progress).toContain("正在合并词库…");
      expect(model.state.phase).toBe("ready");
      expect(model.state.phaseMessage).toBe("");
      expect(model.state.snapshot?.count).toBe(66289);
      expect(model.state.lastReport?.builtStages).toEqual(["stage1"]);
      expect(model.state.session).not.toBeNull();
      expect(model.statusText).toMatch(/^词库已就绪（66289 条 · 跳过 \d+ 条 · 多音字 \d+）$/);
      expect(model.statusChipText).toBe("词库 66,289");
      expect(model.statusIsHealthy).toBe(true);
      expect(chip.value).toBe("词库 66,289");
      expect(healthy.value).toBe(true);
      // 会话拿到了同一份快照
      expect(model.state.session?.lexicon.table).toBe(model.state.snapshot?.table);
    } finally {
      model.dispose();
      io.dispose();
    }
  });

  it("加载失败：failed 状态与文案；之后在设置里恢复成功会补建会话", async () => {
    const io = new FsDataIO();
    try {
      io.bundledMissing.add("lexicon/moe.idx");
      const { model } = newModel(io);
      await model.start();
      expect(model.state.phase).toBe("failed");
      expect(model.state.phaseMessage).toContain("moe");
      expect(model.statusText).toBe(`加载失败：${model.state.phaseMessage}`);
      expect(model.statusChipText).toBe("词库加载失败");
      expect(model.statusIsHealthy).toBe(false);
      expect(model.state.session).toBeNull();

      // 在设置里换一组能用的来源 → adopt → 进入就绪态
      const result = await model.store.applySources(["xinhua", "zdic"]);
      model.adopt(result.snapshot);
      expect(model.state.phase).toBe("ready");
      expect(model.state.session).not.toBeNull();
      expect(model.statusIsHealthy).toBe(true);
      expect(model.statusText).toContain(`词库已就绪（${result.snapshot.count} 条`);
      model.dispose();
    } finally {
      io.dispose();
    }
  });

  it("空词库的文案", async () => {
    const { model, io } = newModel();
    try {
      await model.start();
      // 手动换一张空表快照
      const { IdiomTable } = await import("../../src/core/lexicon/idiomTable");
      const { LexiconSnapshot } = await import("../../src/core/lexicon/types");
      model.adopt(new LexiconSnapshot(IdiomTable.empty, new Map(), ["xinhua"], 0, 99));
      expect(model.statusText).toBe("词库为空，请在设置中选择词库");
      expect(model.statusChipText).toBe("词库为空");
      expect(model.statusIsHealthy).toBe(false);
    } finally {
      model.dispose();
      io.dispose();
    }
  });
});

describe("AppModel · 设置弹层", () => {
  it("打开 / 切页 / 关外观菜单", async () => {
    const { model, io } = newModel();
    try {
      await model.start();
      expect(model.state.settingsOpen).toBe(false);
      expect(model.state.settingsTab).toBe("lexicon");
      model.state.themeMenuOpen = true;
      model.openSettings("appearance");
      expect(model.state.settingsOpen).toBe(true);
      expect(model.state.settingsTab).toBe("appearance");
      expect(model.state.themeMenuOpen, "打开设置会收起外观菜单").toBe(false);

      model.closeSettings();
      expect(model.state.settingsOpen).toBe(false);
      model.openSettings(); // 不带页签：停在上次的页
      expect(model.state.settingsTab).toBe("appearance");
    } finally {
      model.dispose();
      io.dispose();
    }
  });

  it("别的模态层开着时不弹设置", async () => {
    const { model, io } = newModel();
    try {
      await model.start();
      const s = model.state.session!;
      const cases: [string, () => void, () => void][] = [
        ["详细标记", () => (s.state.showDetailPanel = true), () => (s.state.showDetailPanel = false)],
        ["重新开始确认", () => (s.state.restartRequest = { index: 0, word: "x", guessCount: 1 }), () => (s.state.restartRequest = null)],
        ["清空确认", () => (s.state.clearConfirmOpen = true), () => (s.state.clearConfirmOpen = false)],
        [
          "写库确认",
          () => (s.state.persistDialog = { mode: "add", word: "x", pinyin: "x", digit: "x", oldDigit: null }),
          () => (s.state.persistDialog = null),
        ],
      ];
      for (const [name, open, close] of cases) {
        open();
        model.state.themeMenuOpen = true;
        model.openSettings("appearance");
        expect(model.state.settingsOpen, name).toBe(false);
        expect(model.state.settingsTab, `${name}：页签也不改`).toBe("lexicon");
        expect(model.state.themeMenuOpen, `${name}：外观菜单不动`).toBe(true);
        close();
      }
      model.openSettings("appearance");
      expect(model.state.settingsOpen).toBe(true);
    } finally {
      model.dispose();
      io.dispose();
    }
  });

  it("加载中也能打开设置（没有会话时没有守卫）", () => {
    const { model, io } = newModel();
    try {
      model.openSettings("lexicon");
      expect(model.state.settingsOpen).toBe(true);
    } finally {
      io.dispose();
    }
  });
});

describe("AppModel · 写库回调", () => {
  it("会话新增词条：走 store.addIdiom → adopt，会话换上新词库并持久化", async () => {
    const { model, io } = newModel();
    try {
      await model.start();
      const s = model.state.session!;
      const base = model.state.snapshot!;
      const word = "龘龘龘龘";
      expect(base.table.rowForWord(word)).toBeNull();

      s.state.wordInput = word;
      s.loadWord();
      s.state.pinyinInput = "da2 da2 da2 da2";
      s.applyPinyin();
      expect(s.state.persistDialog?.mode).toBe("add");
      await s.confirmPersistPinyin();

      expect(s.state.message).toEqual({ text: `已新增「${word}」到词库（da2 da2 da2 da2）`, kind: "ok" });
      expect(model.state.snapshot?.generation).toBe(2);
      expect(model.state.snapshot?.count).toBe(base.count + 1);
      expect(s.lexicon.table).toBe(model.state.snapshot?.table);
      expect(s.lexicon.table.rowForWord(word)).not.toBeNull();
      expect(model.statusText).toContain(`${base.count + 1} 条`);
      // 改动落盘：下一次启动还在
      const reloaded = await new LexiconStore({ io }).load();
      expect(reloaded.snapshot.table.rowForWord(word)).not.toBeNull();
    } finally {
      model.dispose();
      io.dispose();
    }
  });

  it("会话更新读音：保留释义并换上新快照", async () => {
    const { model, io } = newModel();
    try {
      await model.start();
      const s = model.state.session!;
      const base = model.state.snapshot!;
      const row = base.table.rowForWord("弹无虚发")!;
      const explanation = base.table.explanation(row);

      s.loadWord("弹无虚发");
      s.editDraftSyllable(0, "tan2");
      s.applyDraftPinyin();
      expect(s.state.persistDialog?.mode).toBe("update");
      await s.confirmPersistPinyin();

      expect(s.state.message?.kind).toBe("ok");
      const after = model.state.snapshot!;
      expect(after.generation).toBe(2);
      const row2 = after.table.rowForWord("弹无虚发")!;
      expect(after.table.pinyin(row2)).toBe("tán wú xū fā");
      expect(after.table.explanation(row2)).toBe(explanation);
    } finally {
      model.dispose();
      io.dispose();
    }
  });

  it("没有改动或出错时返回失败文案", async () => {
    const { model, io } = newModel();
    try {
      await model.start();
      // 词库里不存在 → store 返回「词库中不存在」
      expect(await model.persist({ word: "不存在的词", pinyin: "bu4 cun2 zai4 de5 ci2", mode: "update" })).toEqual({
        ok: false,
        message: "词库中不存在「不存在的词」",
      });
      // 音节数不符
      expect(await model.persist({ word: "龘龘龘龘", pinyin: "da2 da2", mode: "add" })).toEqual({
        ok: false,
        message: "「龘龘龘龘」拼音音节数与字数不一致",
      });
      expect(model.state.snapshot?.generation).toBe(1);

      // 写盘失败：抛出的错误变成文案
      io.writeData = async () => {
        throw new Error("磁盘已满");
      };
      const r = await model.persist({ word: "龘龘龘龘", pinyin: "da2 da2 da2 da2", mode: "add" });
      expect(r.ok).toBe(false);
      expect(r.message).toContain("磁盘已满");
      expect(model.state.snapshot?.generation).toBe(1);
    } finally {
      model.dispose();
      io.dispose();
    }
  });
});

describe("DeduceSession · Vue 响应式", () => {
  it("异步筛选完成后，依赖 state 的 effect / computed 会更新", async () => {
    const { model, io } = newModel();
    try {
      await model.start();
      const s = model.state.session!;
      const seen: string[] = [];
      const stop = watchEffect(
        () => {
          seen.push(`${s.state.busy ? "busy" : "idle"}:${s.state.total}`);
        },
        { flush: "sync" },
      );
      const meta = computed(() => s.resultsMeta);
      const hint = computed(() => s.resultsEmptyText);
      expect(meta.value).toBe("");

      s.loadWord("弹无虚发");
      s.setMark(0, "char", "hit");
      expect(meta.value).toContain("（含当前编辑预览）");
      await s.waitForFilter();

      expect(seen[seen.length - 1]).toBe(`idle:${s.state.total}`);
      expect(seen.some((x) => x.startsWith("busy:"))).toBe(true);
      expect(s.state.total).toBeGreaterThan(0);
      expect(meta.value).toBe(`合并 1 条猜测后，共 ${s.state.total} 条候选（含当前编辑预览）`);
      expect(hint.value).toBe("无匹配成语，请检查标记是否矛盾");

      // 写库期间的忙碌文案也是响应式的
      const busyTexts: (string | null)[] = [];
      const stop2 = watchEffect(
        () => {
          busyTexts.push(s.state.lexiconBusyText);
        },
        { flush: "sync" },
      );
      s.clearAll();
      s.state.wordInput = "龘龘龘龘";
      s.state.pinyinInput = "da2 da2 da2 da2";
      s.applyPinyin();
      await s.confirmPersistPinyin();
      stop2();
      stop();
      expect(busyTexts).toContain("正在写入词库…");
      expect(busyTexts[busyTexts.length - 1]).toBeNull();
      await nextTick();
    } finally {
      model.dispose();
      io.dispose();
    }
  });

  it("词库对象不会被深度代理（保持原始类型化数组的访问速度）", async () => {
    const { model, io } = newModel();
    try {
      await model.start();
      const s = model.state.session!;
      expect(s.state.lexicon.table).toBe(model.state.snapshot!.table);
      expect(s.state.lexicon.table.scalars).toBeInstanceOf(Uint32Array);
      expect(s.state.items).toEqual([]);
    } finally {
      model.dispose();
      io.dispose();
    }
  });
});
