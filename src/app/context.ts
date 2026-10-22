// 把应用级状态（AppModel）注入整棵组件树：`app.provide(appModelKey, model)`，组件里 `useAppModel()` 取用。
import { inject, type InjectionKey } from "vue";
import type { AppModel } from "./model";

export const appModelKey: InjectionKey<AppModel> = Symbol("appModel");

export function useAppModel(): AppModel {
  const model = inject(appModelKey);
  if (!model) throw new Error("useAppModel() 必须在 app.provide(appModelKey, …) 之后使用");
  return model;
}
