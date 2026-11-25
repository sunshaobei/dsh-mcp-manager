/**
 * dsh-mcp-manager — 嵌入面板的工作区下拉数据源。
 *
 * 宿主 `/api/dsh-mcp/workspaces` 返回 durable workspace registry 的只读投影；
 * 老宿主/夹具没有该路由时回落空数组，客户端只展示「仅全局 + 当前会话」。
 */

import { api } from "../core/api.ts";
import { API } from "../core/constants.ts";

/** 一个可选工作区（path 是项目级 MCP 配置的路由键）。 */
export interface WorkspaceOption {
  id: string;
  name: string;
  path: string;
}

/** 拉取工作区列表；失败返回空数组（不阻塞面板渲染）。 */
export async function loadWorkspaces(): Promise<WorkspaceOption[]> {
  try {
    const payload = await api<{ workspaces?: WorkspaceOption[] }>(API.workspaces);
    return Array.isArray(payload.workspaces)
      ? payload.workspaces.filter(
          (workspace) =>
            typeof workspace?.path === "string" &&
            workspace.path !== "" &&
            typeof workspace?.name === "string",
        )
      : [];
  } catch {
    return [];
  }
}

/** 默认选中项：当前会话 cwd 命中 registry 时用它，否则「仅全局」。 */
export function defaultWorkspacePath(currentCwd: string | undefined): string {
  return typeof currentCwd === "string" ? currentCwd : "";
}

/** 合并当前会话 cwd 到下拉选项（不在 registry 里的目录也要能选中）。 */
export function withCurrentWorkspace(
  workspaces: WorkspaceOption[],
  currentCwd: string | undefined,
): WorkspaceOption[] {
  if (typeof currentCwd !== "string" || currentCwd === "") return workspaces;
  if (workspaces.some((workspace) => workspace.path === currentCwd)) {
    return workspaces;
  }
  return [
    { id: "current", name: currentCwd.split(/[\\/]/).filter(Boolean).pop() ?? currentCwd, path: currentCwd },
    ...workspaces,
  ];
}
