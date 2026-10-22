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

import {
  SOURCE_IDS,
  parseSourceEntry,
  readSourceFile,
  resolveEffective,
  sourcePath,
  sourceScope,
  type ParsedSource,
  type SourceId,
} from "./sources.ts";
import { isDeepStrictEqual } from "node:util";
import { normalizeServer } from "./normalize.ts";
import type { RoutesManager } from "../connection/interface.ts";

/** 同步摘要：逐名生效/遮蔽 + 跳过说明。 */
export interface SyncSummary {
  effective: { name: string; source: SourceId; scope: string; shadowed: SourceId[] }[];
  removed: { name: string; scope: string }[];
  warnings: string[];
}

/** 读取并解析全部四个来源（projectRoot 未知时项目来源按缺失处理）。 */
export function collectParsedSources(projectRoot?: string): ParsedSource[] {
  return SOURCE_IDS.map((id) => {
    const path = sourcePath(id, projectRoot);
    return parseSourceEntry(id, path, readSourceFile(path ?? ""));
  });
}

/** 互斥同步：读四来源 → 生效表 → 落 manager 两个运行面。 */
export async function syncSourcesIntoManager(
  manager: RoutesManager,
  projectRoot?: string,
  activate: ReadonlyMap<string, SourceId> = new Map(),
): Promise<SyncSummary> {
  const parsed = collectParsedSources(projectRoot);
  const effective = resolveEffective(parsed, activate);
  // A workspace projection owns only its project store. Global declarations are synchronized once,
  // independently: a project winner must never delete another workspace's shared global server.
  for (const [name, item] of effective) {
    if (sourceScope(item.source) !== (projectRoot === undefined ? "global" : "project")) effective.delete(name);
  }
  const summary: SyncSummary = { effective: [], removed: [], warnings: [] };

  // 项目 store 尽早取：失败（无 session）只降级项目侧。
  let projectStore: Awaited<ReturnType<RoutesManager["projectStoreOrThrow"]>> | undefined;
  try {
    if (projectRoot !== undefined) projectStore = await manager.projectStoreOrThrow();
  } catch {
    summary.warnings.push("无项目会话：项目来源本轮未落运行面（连接项目会话后重试）");
  }

  for (const [name, item] of effective) {
    const scope = sourceScope(item.source);
    const store = scope === "global" ? manager.store : projectStore;
    if (store === undefined) {
      summary.warnings.push(`${name}（${item.source}）跳过：项目 store 不可用`);
      continue;
    }
    try {
      // 打上来源标记（落盘持久，客户端按它把服务器归到四个来源分组）。
      // 与 add/update 的存储形态一致：补齐默认值，并稳定 source 字段位置。
      item.config = normalizeServer({ ...item.config, source: item.source });
      const existing = store.find(name);
      if (existing === undefined) {
        await manager.add(item.config as unknown as Record<string, unknown>, scope);
      } else {
        // 用户运行时开关（enabled）是 store 侧事实：来源文件不携带 enabled，
        // 同步重投影时必须沿用既有开关——否则每轮同步都把用户「关掉」的服务器
        // 悄悄重新打开（官方活体预留随即报 serverName already in use）。
        const merged = {
          ...(item.config as Record<string, unknown>),
          ...(existing.enabled !== undefined ? { enabled: existing.enabled } : {}),
        } as Record<string, unknown>;
        if (!isDeepStrictEqual(existing, merged)) {
          // 仅在配置真有变化时 update（update 会 stop+start 重建连接；
          // 无变化时重入会造成「同一 serverName 未释放前不得重复 mount」）。
          await manager.update(name, merged, scope);
        }
      }
      summary.effective.push({ name, source: item.source, scope, shadowed: item.shadowed });
    } catch (error) {
      summary.warnings.push(
        `${name}（${item.source}）落运行面失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // 陈旧条目清理：凡不在生效名单里的名字（迁移遗留 / 来源文件已删但 store 还有）
  // 一律从两个运行面移除+断开——store 的合法内容只有「来源声明的生效表」。
  const staleSweep = async (store: NonNullable<typeof projectStore>, scope: string): Promise<void> => {
    for (const server of [...store.data.servers]) {
      if (effective.has(server.name)) continue;
      // 同上：陈旧清扫走 remove，不写 userDisabled。
      try {
        await manager.remove(server.name, scope);
      } catch {
        /* store 里可能已无此名 */
      }
      store.remove(server.name);
      summary.removed.push({ name: server.name, scope });
    }
  };
  if (projectRoot === undefined) await staleSweep(manager.store, "global");
  if (projectStore !== undefined) await staleSweep(projectStore, "project");

  // 孤儿禁用痕清扫：生效表之外的 userDisabled 记录一律移除（防止历史 disconnect
  // 污染痕把切回/重启后的 start 静默短路成「未连接」）。
  try {
    const globalNames = new Set(
      [...effective.values()].filter((i) => sourceScope(i.source) === "global").map((i) => i.config.name),
    );
    const projectNames = new Set<string>();
    try {
      const current = projectStore ?? await manager.projectStoreOrThrow();
      for (const server of current.data.servers) projectNames.add(server.name);
    } catch { /* no active project */ }
    if (projectRoot === undefined && manager.sweepOrphanUserDisabled !== undefined) {
      await manager.sweepOrphanUserDisabled(globalNames, projectNames);
    }
  } catch (error) {
    summary.warnings.push(
      `孤儿禁用痕清扫失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 确定性回写：把每个 scope 的生效视图整体重写进各自的 .config 生效文件。
  // 文件从此只是「上次同步的投影」——任何后续重读（watcher / 会话切换 / 重启）
  // 都读到与运行面一致的干净状态，不会再被迁移遗留的旧条目拉出分叉。
  try {
    const { readTextFile, writeFileAtomic } = await import("../shared/interface.ts");
    const writeIfChanged = async (path: string, servers: unknown[]) => {
      const text = `${JSON.stringify({ version: 1, servers }, null, 2)}\n`;
      const previous = await readTextFile(path);
      // JSON 键序不是配置变化，避免每次重绑都写盘并触发 watcher/reconcile。
      if (previous !== null) {
        try {
          if (isDeepStrictEqual(JSON.parse(previous), JSON.parse(text))) return;
        } catch { /* 损坏的投影由来源重新生成。 */ }
      }
      await writeFileAtomic(path, text);
    };
    // 回写必须保留 store 侧的运行时 enabled 开关：来源文件不携带该字段，若用
    // 纯来源投影覆盖 .config，refreshFromDisk 重读会把用户「关掉」的服务器静默
    // 还原成开启（延迟自愈式反弹的根因）。
    const withRuntimeEnabled = (
      config: Record<string, unknown>,
      store: { find(name: string): { enabled?: boolean } | undefined },
    ): Record<string, unknown> => {
      const cur = store.find(String(config.name));
      return cur?.enabled !== undefined ? { ...config, enabled: cur.enabled } : config;
    };
    const globalServers = [...effective.values()]
      .filter((item) => sourceScope(item.source) === "global")
      .map((item) => withRuntimeEnabled(item.config as Record<string, unknown>, manager.store));
    if (projectRoot === undefined) await writeIfChanged(manager.store.path, globalServers);
    if (projectRoot !== undefined && projectStore !== undefined) {
      const projectServers = [...effective.values()]
        .filter((item) => sourceScope(item.source) === "project")
        .map((item) => withRuntimeEnabled(item.config as Record<string, unknown>, projectStore));
      await writeIfChanged(projectStore.path, projectServers);
    }
  } catch (error) {
    summary.warnings.push(
      `生效配置回写失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // 回写后统一从盘重读：refreshFromDisk 会按干净文件 reconcile（多退少补），
  // 消除「内存运行面 vs 落盘文件」的最后一点分叉。
  try {
    await manager.refreshFromDisk();
  } catch (error) {
    summary.warnings.push(
      `refreshFromDisk 失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return summary;
}
