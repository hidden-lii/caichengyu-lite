# 猜成语（精简版）

只保留「猜成语」解题功能的轻量版（Tauri 2 + Vue 3）。全部筛选逻辑在前端完成，Rust 端只负责用户数据文件读写；词库随包分发，启动时直接加载，不依赖数据库和网络。

完整版（含截图识别等）见 [caichengyu](https://github.com/hidden-lii/caichengyu)。

## 开发

```bash
npm install
npm run tauri dev      # 桌面窗口
npm run dev            # 只在浏览器里看界面（localStorage 代替数据目录）
npm test               # 单元测试
npm run typecheck      # 类型检查
```

需要 Node.js（LTS）和 Rust（版本见 `rust-toolchain.toml`）。

## 词库

内置 9 个来源（新华、汉文学网、汉语国学、百度汉语、汉典、汉语网、教育部成語典、tool.lu、混合词库）。在「设置 → 词库」里可多选并拖动调整优先级，同一个词出现在多个来源时，拼音与释义以优先级最高的来源为准。也可以在这里新增、修改读音或删除某个词，改动单独保存，切换来源后依然生效。

运行时读取的是烘焙好的列式索引 `public/lexicon/*.idx`，源数据在 `lexicon-src/`。改了源 JSON 后重新烘焙：

```bash
npm run bake                       # lexicon-src/ → public/lexicon/
npm run bake -- --only xinhua,zdic # 只烘焙其中几个
```

## 打包

- 本机（macOS）：`npm run tauri build`
- Windows：推送形如 `v0.1.0` 的 tag，或在 GitHub 的 Actions 页手动运行 **Build Windows**，安装包（NSIS `.exe`）会出现在对应 Release 的 Assets 里。版本号取 `src-tauri/tauri.conf.json` 的 `version`。

## 许可

MIT License，见 [LICENSE](LICENSE)。
