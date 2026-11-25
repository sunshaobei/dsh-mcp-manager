/**
 * dsh-mcp-manager — 嵌入面板（左侧导航 / 设置页）的命令式视图装配。
 *
 * 复用现有管理 UI（renderServers / buildQuickAdd / switchTab / refresh），
 * 只是把「模态壳」换成「页面内嵌壳」：头部 + 标签 + body，没有遮罩/关闭按钮。
 * 每个嵌入视图持有自己的 McpState（currentCwd 来自工作区下拉），与浮窗/模态
 * 的会话绑定状态互不串台。
 */

import { el } from "../core/dom.ts";
import { t } from "../../vendor/shared/client/i18n.js";
import type { McpState, UiActions } from "../core/state.ts";
import type { WorkspaceOption } from "./workspaces.ts";
import { refresh, switchTab } from "../float/panel.ts";
import { beginEdit, resetForm } from "../float/quick-add.ts";

/** 视图状态：只复用 API/UI 配置与列表字段，不挂浮窗/遮罩。 */
export function createEmbeddedState(base: McpState, cwd: string): McpState {
  return {
    ...base,
    overlay: undefined,
    card: undefined,
    bodyEl: undefined,
    countsEl: undefined,
    open: false,
    panelOpener: undefined,
    activeTab: "servers",
    servers: [],
    counts: {},
    editingName: undefined,
    editing: undefined,
    floatPill: undefined,
    floatPanel: undefined,
    floatOpen: false,
    currentCwd: cwd,
    sessionResolved: true,
    warnedUnknownSession: true,
    unknownSessionFrames: 0,
    projectRoot: undefined,
    updateFloatState: undefined,
    API: base.API,
    mcpUiConfig: base.mcpUiConfig,
  };
}

/** 为嵌入视图构造动作面：refresh/switchTab 都落回本视图状态。 */
export function createEmbeddedActions(
  state: McpState,
  base: UiActions,
): UiActions {
  const actions: UiActions = {
    refresh: () => refresh(state, actions),
    resetForm: () => resetForm(state),
    beginEdit: (server) => beginEdit(state, actions, server),
    switchTab: (tab) => switchTab(state, actions, tab),
    close: () => {},
    showPanel: () => base.showPanel(),
    toggleFloat: (force) => base.toggleFloat(force),
  };
  return actions;
}

/** 构建嵌入视图 DOM；返回清理函数。 */
export function mountManagerView(
  container: HTMLElement,
  state: McpState,
  actions: UiActions,
  options: {
    workspaces: WorkspaceOption[];
    onWorkspaceChange?: (path: string) => void;
    showClose?: () => void;
  },
): () => void {
  container.textContent = "";
  container.classList.add("dm-embed-panel");
  state.card = container;

  const head = el("div", { class: "dm-head" });
  head.appendChild(el("h2", { text: t("panelTitle") }));

  const workspaceWrap = el("label", { class: "dm-embed-workspace" });
  workspaceWrap.appendChild(el("span", { text: t("workspaceLabel") }));
  const select = el("select", { class: "dm-embed-select" });
  select.appendChild(el("option", { value: "", text: t("workspaceGlobal") }));
  for (const workspace of options.workspaces) {
    select.appendChild(
      el("option", { value: workspace.path, text: workspace.name }),
    );
  }
  select.value = state.currentCwd ?? "";
  select.addEventListener("change", () => {
    state.currentCwd = select.value;
    state.servers = [];
    state.counts = {};
    state.projectRoot = undefined;
    options.onWorkspaceChange?.(select.value);
    // 按**当前 tab** 重建内容：快速接入页不会在 refresh 完成时被重绘，
    // 只清空 body 会得到一张空白面板（切换工作区后实测）。
    switchTab(state, actions, state.activeTab);
    void refresh(state, actions);
  });
  workspaceWrap.appendChild(select);
  head.appendChild(workspaceWrap);

  const counts = el("span", { class: "dm-counts", text: "" });
  state.countsEl = counts;
  head.appendChild(counts);
  head.appendChild(
    el("button", {
      text: t("refresh"),
      onclick: () => void refresh(state, actions),
    }),
  );
  if (options.showClose !== undefined) {
    head.appendChild(
      el("button", { text: t("close"), onclick: () => options.showClose?.() }),
    );
  }
  container.appendChild(head);

  const tabs = el("div", { class: "dm-tabs" });
  tabs.appendChild(
    el("button", {
      class: "dm-tab",
      dataset: { tab: "servers" },
      text: t("tabServers"),
      onclick: () => switchTab(state, actions, "servers"),
    }),
  );
  tabs.appendChild(
    el("button", {
      class: "dm-tab",
      dataset: { tab: "quick" },
      text: t("tabQuickAdd"),
      onclick: () => switchTab(state, actions, "quick"),
    }),
  );
  container.appendChild(tabs);

  const body = el("div", { class: "dm-body" });
  state.bodyEl = body;
  container.appendChild(body);

  // 初始装配：先画空列表（refresh 完成会重画），再拉取所选工作区。
  state.bodyEl.textContent = "";
  state.bodyEl.appendChild(el("div", { class: "dm-status", text: t("settingsLoading") }));
  switchTab(state, actions, "servers");
  void refresh(state, actions);

  return () => {
    container.classList.remove("dm-embed-panel");
    if (state.card === container) state.card = undefined;
    if (state.bodyEl === body) state.bodyEl = undefined;
    if (state.countsEl === counts) state.countsEl = undefined;
  };
}
