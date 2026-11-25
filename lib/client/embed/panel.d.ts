/**
 * dsh-mcp-manager — 左侧导航 / 设置页的完整管理面板（React 外壳 + 命令式视图）。
 *
 * 外壳只负责「拉工作区列表 + 挂载/卸载视图」；服务器列表、连接控制、快速接入
 * 全部复用 float/ 下的现有实现（见 embed/view.ts）。与浮窗的差别只有一点：
 * 这里的工作区由下拉显式选择，不跟随当前会话。
 */
import * as React from "react";
import type { McpState } from "../core/state.js";
export declare function EmbeddedMcpPanel({ baseState }: {
    baseState: McpState;
}): React.ReactElement;
/** 左侧导航的 MCP 图标（16px 线性网络节点）。 */
export declare function McpNavIcon(): React.ReactElement;
