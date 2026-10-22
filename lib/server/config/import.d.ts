/**
 * dsh-mcp-manager — mcpServers JSON 导入（独立模块）。
 *
 * 把 mcpServers JSON 条目（{ serverName: config }，业界通用格式）映射为
 * 插件服务器配置：解析粘贴的 JSON 文本，供 /api/dsh-mcp/import/json
 * 使用。仅支持 JSON 文本导入（不扫描任何应用的配置文件）。
 * 由 lib/index.js 组合根 re-export。
 */
import type { ServerConfig } from "./impl/model/type.js";
/** 把一条 mcpServers JSON 条目映射为服务器配置：先分派远端/本地，再交各自的映射。 */
export declare function fromClaudeEntry(name: string, entry: Record<string, unknown>): ServerConfig;
/** 解析一段 mcpServers JSON 文本为配置列表。 */
export declare function parseClaudeJson(text: string): ServerConfig[];
/**
 * 把任意来源的服务器名清洗成 SERVER_NAME_PATTERN 合法形态：回答
 * 「"Figma AI Bridge" 这类带空格/大小写混排的名字如何无损导入？」——
 * 非法字符折叠成 "-"、去首尾 "-"、截断到 32 字符、与已用名冲突时追加序号。
 * 返回空串（原名全是非法字符）时回落 "server"。
 */
export declare function normalizeEntryName(raw: string, used: Set<string>): string;
