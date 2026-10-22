// DeduceSession 测试的公共设施：小词库、假时钟、假 persist、可控的筛选执行体。
// 对应 Swift `DeduceSessionTestSupport.swift`。

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LexiconBaker } from "../../../src/core/lexicon/catalog";
import { IdiomTable } from "../../../src/core/lexicon/idiomTable";
import { buildPolyphoneMap } from "../../../src/core/pinyin/polyphone";
import {
  DeduceSession,
  defaultDeduceFilterRunner,
  type DeduceFilterRunner,
} from "../../../src/core/session/session";
import type { DeduceLexicon, PersistOutcome, PersistRequest } from "../../../src/core/session/types";
import { publicDir } from "./fsIO";

// MARK: - 小词库

/** 测试词库（数字调拼音）。故意含：同字首（弹 / 发 / 虚 / 无）、多音字（弹 dan4 / tan2）、可造组合的字。 */
export const deduceSessionWords: readonly (readonly [string, string])[] = [
  ["弹无虚发", "dan4 wu2 xu1 fa1"],
  ["百发百中", "bai3 fa1 bai3 zhong4"],
  ["一心一意", "yi1 xin1 yi1 yi4"],
  ["无中生有", "wu2 zhong1 sheng1 you3"],
  ["虚张声势", "xu1 zhang1 sheng1 shi4"],
  ["弹尽粮绝", "dan4 jin4 liang2 jue2"],
  ["发愤图强", "fa1 fen4 tu2 qiang2"],
  ["一发千钧", "yi1 fa1 qian1 jun1"],
  ["弹冠相庆", "tan2 guan1 xiang1 qing4"],
];

/** 多音字表：弹 dan4 / tan2；发 fa1 / fa4 */
export const deduceSessionPolyJSON = '{"弹":{"default":"dan4","alts":["tan2"]},"发":{"default":"fa1","alts":["fa4"]}}';

export function deduceSessionTable(
  words: readonly (readonly [string, string])[] = deduceSessionWords,
  explanations: Record<string, string> = {},
): IdiomTable {
  const { builder } = LexiconBaker.bake(
    words.map(([word, pinyin]) => ({ word, pinyin, explanation: explanations[word] ?? "" })),
  );
  return IdiomTable.open(builder.serialize());
}

export function deduceSessionLexicon(
  words: readonly (readonly [string, string])[] = deduceSessionWords,
  explanations: Record<string, string> = {},
  poly: string = deduceSessionPolyJSON,
): DeduceLexicon {
  return { table: deduceSessionTable(words, explanations), polyMap: buildPolyphoneMap(poly) };
}

/** 真实词库的 merged.idx（不经过合并，保留读音无效的行）+ 真实多音表，用于集成测试。 */
export function deduceSessionRealLexicon(): DeduceLexicon {
  const raw = readFileSync(join(publicDir, "lexicon/merged.idx"));
  const table = IdiomTable.open(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength));
  const polyMap = buildPolyphoneMap(readFileSync(join(publicDir, "lexicon/polyphones.json"), "utf-8"));
  return { table, polyMap };
}

// MARK: - 假时钟

/** 手动推进的单调时钟（秒）。 */
export class DeduceSessionClock {
  now = 1000;
  advance(seconds: number): void {
    this.now += seconds;
  }
}

// MARK: - 假 persist

/** 记录收到的写库请求，按设定返回结果；可挂一个钩子（比如在写库期间替换词库）。 */
export class DeduceSessionPersistProbe {
  requests: PersistRequest[] = [];
  outcome: PersistOutcome = { ok: true, message: "" };
  hook: ((request: PersistRequest) => Promise<void> | void) | null = null;

  readonly closure = async (request: PersistRequest): Promise<PersistOutcome> => {
    this.requests.push({ ...request });
    if (this.hook) await this.hook(request);
    return this.outcome;
  };
}

// MARK: - 可控的筛选执行体

export type RunnerBehavior =
  | { kind: "normal" }
  /** 一直阻塞到被取消（最长 10 秒兜底），然后返回 null */
  | { kind: "blockUntilCancelled" }
  /** 阻塞到 `release()`，然后正常返回 */
  | { kind: "blockUntilReleased" }
  | { kind: "fail"; message: string };

/** 包一层默认执行体，记录每次调用，并可让指定的调用阻塞（等待取消 / 等待放行）。 */
export class DeduceSessionRunnerProbe {
  /** 每次调用收到的猜测词面（按调用顺序） */
  readonly calls: string[][] = [];
  /** 每次调用结束时是否观察到过取消 */
  readonly sawCancel: boolean[] = [];
  private readonly behaviors = new Map<number, RunnerBehavior>();
  private permits = 0;
  private gateWaiters: (() => void)[] = [];
  private readonly startedWaiters = new Map<number, (() => void)[]>();
  private readonly finishedWaiters = new Map<number, (() => void)[]>();

  get callCount(): number {
    return this.calls.length;
  }

  /** 第 n 次调用（从 0 起）的行为；未设置则 normal。 */
  setBehavior(b: RunnerBehavior, forCall: number): void {
    this.behaviors.set(forCall, b);
  }

  release(): void {
    const waiter = this.gateWaiters.shift();
    if (waiter) waiter();
    else this.permits += 1;
  }

  /** 第 n 次调用已经开始（可能早已开始）。 */
  started(n: number): Promise<void> {
    if (this.calls.length > n) return Promise.resolve();
    return new Promise((resolve) => {
      const list = this.startedWaiters.get(n) ?? [];
      list.push(resolve);
      this.startedWaiters.set(n, list);
    });
  }

  /** 第 n 次调用已经结束。 */
  finished(n: number): Promise<void> {
    if (this.finishedFlags.has(n)) return Promise.resolve();
    return new Promise((resolve) => {
      const list = this.finishedWaiters.get(n) ?? [];
      list.push(resolve);
      this.finishedWaiters.set(n, list);
    });
  }

  private readonly finishedFlags = new Set<number>();

  private gate(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.gateWaiters.push(resolve));
  }

  readonly runner: DeduceFilterRunner = async (request, isCancelled) => {
    const n = this.calls.length;
    this.calls.push(request.guesses.map((g) => g.word));
    this.sawCancel.push(false);
    const behavior = this.behaviors.get(n) ?? { kind: "normal" };
    for (const w of this.startedWaiters.get(n) ?? []) w();
    try {
      switch (behavior.kind) {
        case "normal":
          break;
        case "blockUntilCancelled": {
          const deadline = Date.now() + 10_000;
          while (!isCancelled() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 1));
          this.sawCancel[n] = isCancelled();
          return null;
        }
        case "blockUntilReleased":
          await this.gate();
          break;
        case "fail":
          throw new Error(behavior.message);
      }
      const outcome = await defaultDeduceFilterRunner(request, isCancelled);
      this.sawCancel[n] = isCancelled();
      return outcome;
    } finally {
      this.finishedFlags.add(n);
      for (const w of this.finishedWaiters.get(n) ?? []) w();
    }
  };
}

// MARK: - 构造会话

export function makeDeduceSession(
  lexicon: DeduceLexicon,
  opts: {
    persist?: DeduceSessionPersistProbe;
    clock?: DeduceSessionClock;
    debounceMs?: number;
    runner?: DeduceFilterRunner;
  } = {},
): DeduceSession {
  const persist = opts.persist ?? new DeduceSessionPersistProbe();
  const clock = opts.clock ?? new DeduceSessionClock();
  return new DeduceSession({
    lexicon,
    persist: persist.closure,
    debounceMs: opts.debounceMs ?? 0,
    uptime: () => clock.now,
    runner: opts.runner ?? defaultDeduceFilterRunner,
  });
}

// MARK: - 断言辅助

/** 候选词面（按词库行序） */
export function itemWords(s: DeduceSession): string[] {
  return s.state.items.map((i) => i.word);
}

/** 直接等当前筛选跑完并返回候选词面 */
export async function settledWords(s: DeduceSession): Promise<string[]> {
  await s.waitForFilter();
  return itemWords(s);
}

/** 值快照（深拷贝成普通对象），用来保存「之前的状态」再与之后比较。 */
export function snap<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}
