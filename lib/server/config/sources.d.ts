/**
 * dsh-mcp-manager — 声明式多源 mcp.json 配置（独立模块）。
 *
 * 四个声明来源，默认全部读取：
 *   - 全局：~/.agents/mcp.json 与 ~/.dsh/mcp.json
 *   - 项目：<项目根>/.agents/mcp.json 与 <项目根>/.dsh/mcp.json
 *
 * 同名互斥原则：同一个服务器名在多个来源出现时，**只允许一个生效**——
 * 生效者进入对应 scope 的 store 并连接；落选者不落盘（若其 scope store
 * 已有同名旧配置则移除，防止跨 scope 串台）。生效优先级：
 *   project-agents > project-dsh > global-agents > global-dsh，
 * 用户可用 activateSource 显式改选（记忆在 user-state 的 activeSource 表）。
 *
 * 本模块只做纯逻辑（路径 / 解析 / 优先级 / 生效表计算），落盘与 manager
 * 装配由 routes-controllers 的控制器驱动。
 */
import type { ServerConfig } from "./impl/model/type.js";
/** 四个声明来源的稳定 id（客户端 tabs / user-state 记忆都用它）。 */
export type SourceId = "global-agents" | "global-dsh" | "project-agents" | "project-dsh";
export declare const SOURCE_IDS: readonly SourceId[];
/** 来源所属 scope：前两个进全局 store，后两个进项目 store。 */
export declare function sourceScope(id: SourceId): "global" | "project";
/** 某来源的 mcp.json 绝对路径。projectRoot 缺省时项目来源返回 null。 */
export declare function sourcePath(id: SourceId, projectRoot?: string): string | null;
/** 生效优先级（高 → 低）。 */
export declare const SOURCE_PRIORITY: readonly SourceId[];
/** 读一个来源的原始文本；文件不存在返回 null（不抛）。 */
export declare function readSourceFile(path: string): string | null;
/** 写一个来源的 mcp.json（自动建父目录；644）。返回写入字节数。 */
export declare function writeSourceFile(path: string, text: string): number;
/** 一个来源的解析结果：成功给 servers；失败给 error（坏文件不拖垮其余来源）。 */
export type ParsedSource = {
    id: SourceId;
    path: string | null;
    exists: boolean;
    servers: ServerConfig[];
    error?: string;
};
/** 解析单个来源文本（容错：JSON 坏 / 条目坏都记 error，不抛）。 */
export declare function parseSourceEntry(id: SourceId, path: string | null, text: string | null): ParsedSource;
/**
 * 同名互斥的生效表：回答「每个名字最终由哪个来源的哪份配置生效？」——
 * 按优先级取第一个声明者；activate 覆盖优先级（但该来源必须真的声明了此名）。
 * 未命中的名字不出现在结果里；每个名字同时给出落选来源清单（供上层禁用/清理）。
 */
export declare function resolveEffective(parsed: readonly ParsedSource[], activate?: ReadonlyMap<string, SourceId>): Map<string, {
    source: SourceId;
    config: ServerConfig;
    shadowed: SourceId[];
}>;
