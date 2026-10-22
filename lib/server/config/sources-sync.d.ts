/**
 * dsh-mcp-manager — 多源同步执行层：把四个声明来源的「生效表」落进 manager。
 *
 * 纯解析在 sources.ts（本模块消费它）；这里回答「生效表如何无损落进运行面」：
 *   - 每个生效名按其来源 scope 走 add/update（同名已存在即 update，等效覆盖）
 *   - 全局来源只更新共享全局配置，项目来源只更新指定项目的配置；
 *     同名互斥按工作区投影，不删除其他工作区仍需使用的全局配置。
 *   - 项目 store 需要 session（projectStoreOrThrow）；无 session 时项目侧
 *     跳过并在摘要里说明，不抛错（面板会在有会话后重新同步）
 *
 * 写盘（用户编辑保存）由控制器完成；本模块只读来源文件 → 解析 → 落运行面。
 */
import { type ParsedSource, type SourceId } from "./sources.js";
import type { RoutesManager } from "../connection/interface.js";
/** 同步摘要：逐名生效/遮蔽 + 跳过说明。 */
export interface SyncSummary {
    effective: {
        name: string;
        source: SourceId;
        scope: string;
        shadowed: SourceId[];
    }[];
    removed: {
        name: string;
        scope: string;
    }[];
    warnings: string[];
}
/** 读取并解析全部四个来源（projectRoot 未知时项目来源按缺失处理）。 */
export declare function collectParsedSources(projectRoot?: string): ParsedSource[];
/** 互斥同步：读四来源 → 生效表 → 落 manager 两个运行面。 */
export declare function syncSourcesIntoManager(manager: RoutesManager, projectRoot?: string, activate?: ReadonlyMap<string, SourceId>): Promise<SyncSummary>;
