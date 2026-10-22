<script setup lang="ts">
// 设置弹层（= SettingsContainer.swift 的 SettingsView，⌘, / 应用栏齿轮打开）：词库、外观两页。
//
// 以窗口模态的 MSheet 盖在主界面之上，而不是独立窗口：关闭之前主窗口里的任何东西（按钮、输入框、快捷键、Tab）都点不到。
// 面板在窗口里水平、垂直居中（placement="center"），不贴着窗口顶端。
// 宽度 640 是基础值：字号放大等原因让内容放不下时，MSheet 会自动加宽（最宽到窗口边缘），尽量不出现横向滚动条。
// 点右上角「完成」或按 Esc 关闭。显隐由 `model.state.settingsOpen` 控制，所在页签由 `model.state.settingsTab` 控制；
// 没有 props，RootView 无条件挂载即可。
//
// 弹层的内容（标题栏 + 两页）放在 settings/SettingsBody.vue：MSheet 关闭后会卸载插槽，
// 内容跟着销毁，下次打开重新创建（= SwiftUI `.sheet` 每次弹出重建内容，词库页的勾选从当前快照重新取）。
import { computed } from "vue";
import { useAppModel } from "../app/context";
import SettingsBody from "./settings/SettingsBody.vue";
import { MSheet } from "./ui";

const model = useAppModel();

const open = computed<boolean>({
  get: () => model.state.settingsOpen,
  set: (v) => {
    if (v) model.state.settingsOpen = true;
    else model.closeSettings();
  },
});
</script>

<template>
  <MSheet v-model="open" :width="640" placement="center" :radius="12" label="设置">
    <SettingsBody />
  </MSheet>
</template>
