/**
 * dsh-mcp-manager — workspace/impl/root-resolution/index.ts：项目根发现与执行路由解析。
 *
 * 阶段 4 自 src/manager.ts（findProjectRoot/normalizedProjectRoot 方法）与
 * src/apply-runtime.ts（makeResolveRoot）迁入工作空间路由域，纯函数化
 * （不再依赖 manager 实例）；B3 修复（空 cwd 回落含 runtime 源）落位
 * makeResolveRoot。引用面经 workspace/interface.ts。
 */
import type { McpManager } from "../../../connection/interface.js";
/** 项目根发现：从 cwd 向上找 .git / .dsh / .mcp.json 标记，找不到用 cwd 本身。
 *  .dsh 标记须排除 DSH 全局家目录（默认 ~/.dsh，尊重 DSH_HOME）——否则 home
 *  下任何无标记目录（如 ~/dev/leetcode）向上都会命中 ~/.dsh，把 home 误判为
 *  项目根并加载 ~/.dsh/dsh-mcp-manager/mcp.json，导致别的会话串入不属于它的项目级 MCP。 */
export declare function findProjectRoot(cwd: string | undefined): Promise<string>;
/** 归一化项目根（realpath；失败回退 resolve）。中间层路由使用。 */
export declare function normalizedProjectRoot(cwd: string | undefined): Promise<string | undefined>;
/** resolveRoot 路由：exec.agent → 归一化项目根（agent-less → undefined）。 */
export declare function makeResolveRoot(manager: McpManager): (agent: unknown) => Promise<string | undefined>;
