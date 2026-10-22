// 启动守卫（普通脚本，不经打包）：应用没能挂载成界面时，不要留一片空白，把原因直接显示在窗口里。
//
// 为什么单独放一个脚本：主程序（/assets/index-*.js）本身加载失败、或一启动就抛错时，里面的任何兜底代码都跑不起来；
// 这个脚本很小、与主程序无关，先于它加载，能兜住「主脚本没加载 / 启动时抛错 / 一直卡在某一步」这几种情况。
//
// 约定：src/main.ts 在每个启动阶段调用 window.__CC_BOOT__.stage(名字)，挂载成功后调用 mounted()，失败时调用 fail(原因)。
// 6 秒内没挂载，或挂载前出现脚本错误 / 资源加载失败，就弹出错误面板（内容可选中复制，也可以直接截图）。
(function () {
  "use strict";

  var WATCHDOG_MS = 6000;
  var stages = [];
  var errors = [];
  var mounted = false;
  // 主程序明确报告了启动失败（fail）：即使之后「挂载」了也要显示，因为界面多半是坏的
  var forced = false;
  var panel = null;

  function describe(value) {
    if (value && value.stack) return String(value.stack);
    if (value && value.message) return String(value.message);
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value);
    } catch (e) {
      return String(value);
    }
  }

  function environment() {
    return [
      "地址：" + location.href,
      "内核：" + navigator.userAgent,
      "Tauri 环境：" + ("__TAURI_INTERNALS__" in window ? "是" : "否（页面里没有 __TAURI_INTERNALS__）"),
      "已完成的启动阶段：" + (stages.length > 0 ? stages.join(" → ") : "（没有，主脚本没有开始运行）"),
    ].join("\n");
  }

  function render() {
    if (mounted && !forced) return;
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", render);
      return;
    }
    if (!panel) {
      panel = document.createElement("div");
      panel.id = "cc-boot-error";
      var s = panel.style;
      s.position = "fixed";
      s.top = "0";
      s.left = "0";
      s.right = "0";
      s.bottom = "0";
      s.zIndex = "2147483647";
      s.overflow = "auto";
      s.boxSizing = "border-box";
      s.padding = "24px";
      s.background = "#fff";
      s.color = "#222";
      s.font = "14px/1.6 system-ui, 'Microsoft YaHei', sans-serif";
      s.userSelect = "text";
      s.webkitUserSelect = "text";
      document.body.appendChild(panel);
    }
    panel.textContent = "";

    var title = document.createElement("h2");
    title.textContent = "猜成语 没能正常启动";
    title.style.margin = "0 0 8px";
    panel.appendChild(title);

    var hint = document.createElement("p");
    hint.textContent = "把下面的内容截图或复制发给开发者，就能定位问题。";
    hint.style.margin = "0 0 12px";
    hint.style.color = "#666";
    panel.appendChild(hint);

    var pre = document.createElement("pre");
    pre.style.margin = "0";
    pre.style.whiteSpace = "pre-wrap";
    pre.style.wordBreak = "break-all";
    pre.style.font = "12px/1.5 Consolas, 'Courier New', monospace";
    pre.textContent =
      (errors.length > 0 ? errors.join("\n\n") : "（没有捕获到脚本错误：脚本可能没有加载，或一直停在某一步）") +
      "\n\n" +
      environment();
    panel.appendChild(pre);
  }

  function addError(text) {
    // 同一条错误只记一次
    if (errors.indexOf(text) === -1) errors.push(text);
    render();
  }

  // 捕获阶段监听，才能收到 <script> / <link> 加载失败这类不冒泡的资源错误
  window.addEventListener(
    "error",
    function (e) {
      if (mounted) return;
      var target = e.target;
      if (target && target !== window && (target.src || target.href)) {
        addError("资源加载失败：" + (target.src || target.href));
        return;
      }
      addError("脚本错误：" + describe(e.error || e.message) + (e.filename ? "\n位置：" + e.filename + ":" + e.lineno : ""));
    },
    true,
  );
  window.addEventListener("unhandledrejection", function (e) {
    if (mounted) return;
    addError("未处理的 Promise 错误：" + describe(e.reason));
  });

  window.setTimeout(function () {
    if (!mounted) render();
  }, WATCHDOG_MS);

  window.__CC_BOOT__ = {
    stage: function (name) {
      stages.push(String(name));
    },
    fail: function (message) {
      forced = true;
      addError(describe(message));
    },
    mounted: function () {
      mounted = true;
      window.__CC_MOUNTED__ = true;
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      panel = null;
    },
  };
})();
