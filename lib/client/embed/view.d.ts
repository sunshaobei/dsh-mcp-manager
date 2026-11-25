/**
 * dsh-mcp-manager — 嵌入面板（左侧导航 / 设置页）的命令式视图装配。
 *
 * 复用现有管理 UI（renderServers / buildQuickAdd / switchTab / refresh），
 * 只是把「模态壳」换成「页面内嵌壳」：头部 + 标签 + body，没有遮罩/关闭按钮。
 * 每个嵌入视图持有自己的 McpState（currentCwd 来自工作区下拉），与浮窗/模态
 * 的会话绑定状态互不串台。
 */
import type { McpState, UiActions } from "../core/state.js";
import type { WorkspaceOption } from "./workspaces.js";
/** 视图状态：只复用 API/UI 配置与列表字段，不挂浮窗/遮罩。 */
export declare function createEmbeddedState(base: McpState, cwd: string): McpState;
/** 为嵌入视图构造动作面：refresh/switchTab 都落回本视图状态。 */
export declare function createEmbeddedActions(state: McpState, base: UiActions): UiActions;
/** 构建嵌入视图 DOM；返回清理函数。 */
export declare function mountManagerView(container: HTMLElement, state: McpState, actions: UiActions, options: {
    workspaces: WorkspaceOption[];
    onWorkspaceChange?: (path: string) => void;
    showClose?: () => void;
}): () => void;
