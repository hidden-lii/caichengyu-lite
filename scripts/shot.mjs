#!/usr/bin/env node
// 无头 Chrome 截图 / 像素对比工具（零依赖，用 Chrome DevTools Protocol）。
//
// 截图：
//   node scripts/shot.mjs shot --url "http://127.0.0.1:1420/?scene=main" --out out.png \
//        [--size 1240x860] [--scale 2] [--wait-ready] [--timeout 60000] [--eval "js 表达式"]
//   --wait-ready  等到 window.__CC_READY__ === true（应用在词库载入、场景布置完后自行置位）再截图
//   --eval        截图前在页面里执行的 JS（可 await），例如点开某个弹层
//   --print-eval "js"  截图后再执行并把返回值（JSON）打印到 stdout 的 result 字段
//   --clip-selector "css"  只截该元素的包围盒（取整后），用来和只截弹层内容的基准图对比
//
// 对比：
//   node scripts/shot.mjs diff --a ours.png --b reference.png [--out diff.png] [--fit]
//   输出 JSON：{ width, height, meanAbsDiff(0~255), changedRatio(差异>24 的像素占比) }，并写出 [a | b | 差异热图] 三联图。
//   --fit  两图尺寸不同时，把 a 缩放到 b 的尺寸再比（默认尺寸不同直接报错）
//
// 环境变量：CHROME_BIN 可覆盖 Chrome 路径。

import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME =
  process.env.CHROME_BIN || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[key] = true;
      else {
        out[key] = next;
        i++;
      }
    } else out._.push(a);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome(width, height, scale) {
  const scratch = process.env.KIROCREW_SCRATCH || tmpdir();
  const profile = mkdtempSync(join(scratch, "cc-chrome-"));
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--hide-scrollbars",
      "--mute-audio",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${width},${height}`,
      `--force-device-scale-factor=${scale}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let wsUrl = null;
  for (let i = 0; i < 100 && !wsUrl; i++) {
    await sleep(100);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      wsUrl = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? null;
    } catch {
      /* 还没起来 */
    }
  }
  if (!wsUrl) {
    proc.kill();
    throw new Error("Chrome 没有按时启动");
  }
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error("DevTools 连接失败"));
  });
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(`${msg.error.message}`));
      else resolve(msg.result);
    } else if (msg.method) listeners.forEach((l) => l(msg));
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const close = () => {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    proc.kill();
    setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
  };
  return { send, close, listeners };
}

async function evaluate(send, expression, awaitPromise = true) {
  const r = await send("Runtime.evaluate", {
    expression,
    awaitPromise,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result.value;
}

async function cmdShot(args) {
  if (!args.url || !args.out) throw new Error("需要 --url 和 --out");
  const [w, h] = String(args.size || "1240x860").split("x").map(Number);
  const scale = Number(args.scale || 2);
  const timeout = Number(args.timeout || 60000);
  const chrome = await launchChrome(w, h, scale);
  const { send } = chrome;
  try {
    const logs = [];
    chrome.listeners.push((m) => {
      if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type)) {
        logs.push(`[console.${m.params.type}] ` + m.params.args.map((a) => a.value ?? a.description).join(" "));
      }
      if (m.method === "Runtime.exceptionThrown") {
        logs.push(`[exception] ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`);
      }
    });
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: w,
      height: h,
      deviceScaleFactor: scale,
      mobile: false,
    });
    await send("Page.navigate", { url: args.url });
    const t0 = Date.now();
    if (args["wait-ready"]) {
      for (;;) {
        if (await evaluate(send, "window.__CC_READY__ === true", false).catch(() => false)) break;
        if (Date.now() - t0 > timeout) throw new Error("等待 __CC_READY__ 超时\n" + logs.join("\n"));
        await sleep(150);
      }
    } else {
      await sleep(1500);
    }
    if (args.eval) {
      await evaluate(send, String(args.eval));
    }
    // 等字体 / 动画 / 过渡稳定
    await evaluate(send, "document.fonts ? document.fonts.ready.then(() => true) : true");
    await sleep(Number(args.settle || 600));
    const shotParams = { format: "png", captureBeyondViewport: false };
    if (args["clip-selector"]) {
      const r = await evaluate(
        send,
        `(() => { const el = document.querySelector(${JSON.stringify(String(args["clip-selector"]))}); if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }; })()`,
        false,
      );
      if (!r) throw new Error(`找不到 --clip-selector 指定的元素：${args["clip-selector"]}`);
      shotParams.clip = { ...r, scale: 1 };
    }
    const shot = await send("Page.captureScreenshot", shotParams);
    writeFileSync(args.out, Buffer.from(shot.data, "base64"));
    let result = null;
    if (args["print-eval"]) result = await evaluate(send, String(args["print-eval"]));
    console.log(JSON.stringify({ out: args.out, size: `${w}x${h}@${scale}x`, logs, result }, null, 2));
  } finally {
    chrome.close();
  }
}

async function cmdDiff(args) {
  if (!args.a || !args.b) throw new Error("需要 --a 和 --b");
  const a64 = readFileSync(args.a).toString("base64");
  const b64 = readFileSync(args.b).toString("base64");
  const chrome = await launchChrome(800, 600, 1);
  try {
    await chrome.send("Runtime.enable");
    const fit = args.fit ? "true" : "false";
    const expr = `(async () => {
      const load = async (b64) => {
        const blob = await (await fetch('data:image/png;base64,' + b64)).blob();
        return await createImageBitmap(blob);
      };
      const A = await load(${JSON.stringify(a64)});
      const B = await load(${JSON.stringify(b64)});
      const fit = ${fit};
      if (!fit && (A.width !== B.width || A.height !== B.height)) {
        return { error: 'size mismatch', a: [A.width, A.height], b: [B.width, B.height] };
      }
      const W = B.width, H = B.height;
      const ca = new OffscreenCanvas(W, H), cb = new OffscreenCanvas(W, H);
      const xa = ca.getContext('2d', { willReadFrequently: true });
      const xb = cb.getContext('2d', { willReadFrequently: true });
      xa.drawImage(A, 0, 0, W, H);
      xb.drawImage(B, 0, 0, W, H);
      const da = xa.getImageData(0, 0, W, H).data;
      const db = xb.getImageData(0, 0, W, H).data;
      const out = new OffscreenCanvas(W * 3, H);
      const xo = out.getContext('2d');
      xo.drawImage(ca, 0, 0);
      xo.drawImage(cb, W, 0);
      const heat = xo.createImageData(W, H);
      let sum = 0, changed = 0;
      for (let i = 0; i < da.length; i += 4) {
        const d = (Math.abs(da[i] - db[i]) + Math.abs(da[i+1] - db[i+1]) + Math.abs(da[i+2] - db[i+2])) / 3;
        sum += d;
        if (d > 24) changed++;
        const v = Math.min(255, d * 4);
        heat.data[i] = 255; heat.data[i+1] = 255 - v; heat.data[i+2] = 255 - v; heat.data[i+3] = 255;
      }
      xo.putImageData(heat, W * 2, 0);
      const blob = await out.convertToBlob({ type: 'image/png' });
      const buf = new Uint8Array(await blob.arrayBuffer());
      let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      return { width: W, height: H, meanAbsDiff: +(sum / (W * H)).toFixed(3), changedRatio: +(changed / (W * H)).toFixed(4), png: btoa(bin) };
    })()`;
    const res = await evaluate(chrome.send, expr);
    if (res.error) throw new Error(`${res.error}: a=${res.a} b=${res.b}（可加 --fit）`);
    const { png, ...stats } = res;
    if (args.out) writeFileSync(args.out, Buffer.from(png, "base64"));
    console.log(JSON.stringify({ ...stats, out: args.out ?? null }, null, 2));
  } finally {
    chrome.close();
  }
}

const args = parseArgs(process.argv.slice(2));
const cmd = args._[0];
try {
  if (cmd === "shot") await cmdShot(args);
  else if (cmd === "diff") await cmdDiff(args);
  else {
    console.error("用法：shot.mjs shot|diff …（见文件头注释）");
    process.exit(2);
  }
} catch (e) {
  console.error(String(e?.message ?? e));
  process.exit(1);
}
