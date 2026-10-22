import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

// Tauri 2 推荐配置：固定端口、不清屏、只暴露 TAURI_ENV_* 与 VITE_* 环境变量。
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [vue()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // macOS 用 WebKit，Windows 用 WebView2（Chromium）；界面用到 oklch() 等，目标取较新的内核。
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome111" : "safari16",
    minify: process.env.TAURI_ENV_DEBUG ? false : "oxc",
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
