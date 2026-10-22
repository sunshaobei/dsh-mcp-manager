/**
 * dsh-mcp-manager — 客户端「快速接入」页：多源 mcp.json 编辑器与保存执行面。
 *
 * 手填表单已整体移除（v0.4.0）：添加/编辑一律经「多源 mcp.json 编辑器」
 * （beginEdit 打开 openJsonEditor，保存走 performSaveRequest）。跨模块动作
 * （refresh / switchTab）经 actions 注入，不直接引用 panel 模块，避免循环依赖。
 */
import type { McpState, UiActions } from "../core/state.js";
import type { McpManagerServerInput, McpServerListEntry } from "../../shared/interface.js";
/** 当前保存归属（project/global）：按 projectRoot 回落，无 DOM 依赖。 */
export declare function formScopeValue(state: McpState): string;
/** 当前会话 cwd（POST body 携带，宿主据此切换项目级 MCP）。 */
export declare function currentCwdBody(state: McpState): Record<string, string>;
/** 是否处于编辑态（editingName 已设）。 */
export declare function isEditing(state: McpState): boolean;
/** 重置编辑态（表单已移除，只清编辑面）。 */
export declare function resetForm(state: McpState): void;
/** 迁移式保存判据：正在编辑，且（改名 或 改归属）。宿主 PATCH 按 (scope,name) 定位且
 * 强制沿用定位名，故这两类改动必须走 POST+DELETE（见 performSaveRequest）。 */
export declare function isMigratedEdit(state: McpState, server: McpManagerServerInput, payload: Record<string, unknown>): boolean;
/** JSON 写请求的公共 init（PATCH / POST 共用）。 */
export declare function jsonWriteInit(payload: Record<string, unknown>): {
    method: "POST" | "PATCH";
    headers: Record<string, string>;
    body: string;
};
/**
 * 保存执行面（三种落点）与中止信号。
 * C11 迁移式保存：宿主 PATCH 按 (scope,name) 定位且强制沿用定位名——编辑改名/改归属
 * 会 404 not found 无引导。先 POST 新条目再 DELETE 旧条目，任何失败即抛（保留原条目），
 * 避免半迁移脏数据。
 * @returns false = 已中止（大声失败），调用方不得 refresh。
 */
export declare function performSaveRequest(state: McpState, server: McpManagerServerInput, payload: Record<string, unknown>): Promise<boolean>;
/** 进入编辑模式：记录编辑态并弹出大号 JSON 编辑器（行内编辑太小，弃用表单填充）。 */
export declare function beginEdit(state: McpState, actions: UiActions, server: McpServerListEntry): void;
/** 构建「快速接入」页面（多源 mcp.json 编辑器）。 */
export declare function buildQuickAdd(state: McpState, actions: UiActions): HTMLElement;
