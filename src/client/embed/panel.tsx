/**
 * dsh-mcp-manager — 左侧导航 / 设置页的完整管理面板（React 外壳 + 命令式视图）。
 *
 * 外壳只负责「拉工作区列表 + 挂载/卸载视图」；服务器列表、连接控制、快速接入
 * 全部复用 float/ 下的现有实现（见 embed/view.ts）。与浮窗的差别只有一点：
 * 这里的工作区由下拉显式选择，不跟随当前会话。
 */

import * as React from "react";
import { t } from "../../vendor/shared/client/i18n.js";
import type { McpState, UiActions } from "../core/state.ts";
import {
  createEmbeddedActions,
  createEmbeddedState,
  mountManagerView,
} from "./view.ts";
import {
  defaultWorkspacePath,
  loadWorkspaces,
  withCurrentWorkspace,
  type WorkspaceOption,
} from "./workspaces.ts";

const NOOP_BASE: UiActions = {
  refresh: async () => false,
  resetForm: () => {},
  beginEdit: () => {},
  switchTab: () => {},
  close: () => {},
  showPanel: () => {},
  toggleFloat: () => {},
};

export function EmbeddedMcpPanel({ baseState }: { baseState: McpState }): React.ReactElement {
  const [workspaces, setWorkspaces] = React.useState<WorkspaceOption[] | null>(null);
  const hostRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    let live = true;
    void loadWorkspaces().then((rows) => {
      if (!live) return;
      setWorkspaces(withCurrentWorkspace(rows, baseState.currentCwd));
    });
    return () => {
      live = false;
    };
  }, [baseState]);

  React.useEffect(() => {
    const host = hostRef.current;
    if (host === null || workspaces === null) return;
    const state = createEmbeddedState(
      baseState,
      defaultWorkspacePath(baseState.currentCwd),
    );
    const actions = createEmbeddedActions(state, NOOP_BASE);
    return mountManagerView(host, state, actions, { workspaces });
  }, [workspaces, baseState]);

  if (workspaces === null) {
    return (
      <div className="dm-embed">
        <div className="dm-status">{t("settingsLoading")}</div>
      </div>
    );
  }
  return (
    <div className="dm-embed">
      <div className="dm-embed-host" ref={hostRef} />
    </div>
  );
}

/** 左侧导航的 MCP 图标（16px 线性网络节点）。 */
export function McpNavIcon(): React.ReactElement {
  return React.createElement(
    "svg",
    {
      width: 16,
      height: 16,
      viewBox: "0 0 24 24",
      fill: "none",
      "aria-hidden": "true",
    },
    React.createElement("circle", { cx: 6, cy: 12, r: 2.2, stroke: "currentColor", strokeWidth: 1.6 }),
    React.createElement("circle", { cx: 18, cy: 6, r: 2.2, stroke: "currentColor", strokeWidth: 1.6 }),
    React.createElement("circle", { cx: 18, cy: 18, r: 2.2, stroke: "currentColor", strokeWidth: 1.6 }),
    React.createElement("path", {
      d: "M8.1 11.1 15.9 6.9M8.1 12.9l7.8 4.2",
      stroke: "currentColor",
      strokeWidth: 1.6,
      strokeLinecap: "round",
    }),
  );
}
