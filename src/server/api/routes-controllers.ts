/**
 * dsh-mcp-manager — 路由控制器工厂（#592 阶段二 Batch A：makeRoutes 消峰）。
 *
 * 每个控制器是「buildXxxRoute(manager, helpers) → WebRoute」形态的纯工厂：
 * 拆分前 makeRoutes 单函数圈复杂度 84（全仓第一），复杂度全部来自内联在各
 * 路由 handler 闭包中的方法分流与字段校验分支；拆分后 makeRoutes 退化为
 * 数组装配（comp <= 15），每个控制器的分支彼此独立、可独立理解与测试。
 *
 * 行为约束（与拆分前逐字节等价）：
 * - 路由路径与围栏（方法白名单 / loopback 豁免）取自 shared/routes.ts 单点；
 * - loopback 围栏与 405 分流顺序不变（#473 R2：config GET 豁免 loopback，
 *   白名单外方法先于 loopback 直接 405）；
 * - JSON body 字节上限沿用 readJsonBody 的默认行为（历史上那个显式上限
 *   常量 MAX_JSON_BODY_BYTES 已不存在）。
 *
 * 跨域取数一律经 apiPorts（见 deps.ts 与 impl/service），值为模块求值期绑定：
 * installApi 在包入口顶层完成，handler 内的 get() 取到的一定是装配后的能力。
 */

import {
  writeJson,
  readJsonBody,
  readJsonBodyOutcome,
  guardLoopbackMethod,
} from "../../vendor/shared/host-utils.js";
import type { WebRoute } from "@deepseek-ai/dsh-host-webserver";
import { readFile } from "node:fs/promises";
import {
  SOURCE_IDS,
  parseSourceEntry,
  resolveEffective,
  readSourceFile,
  sourcePath,
  sourceScope,
  writeSourceFile,
  type SourceId,
} from "../config/sources.ts";
import { syncSourcesIntoManager } from "../config/sources-sync.ts";
import { findProjectRoot } from "../workspace/impl/root-resolution/index.ts";
import { readTextFile, sourcePrefsPath, writeFileAtomic } from "../shared/interface.ts";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { RoutesManager } from "../connection/interface.ts";
import type { ServerConfig } from "../config/interface.ts";
import type { McpStore } from "../store/interface.ts";
// 跨端契约常量取自共享层门面（物理定义在 shared/constants.ts），不再经 workspace 门面转出。
import {
  MIDDLEWARE_GLOBAL_ROOT,
  SCOPE_PROJECT,
  ROUTES,
  ROUTE_FENCE,
} from "../../shared/interface.ts";
import type { RouteName } from "../../shared/interface.ts";
import { apiPorts } from "./impl/service/index.ts";
import { queryParam } from "./routes-helpers.ts";

/** 控制器共享 helpers（原 makeRoutes 闭包三件套，提升为显式参数）。 */
export interface RouteHelpers {
  handleError(res: ServerResponse, error: unknown): void;
  scopeParam(url: URL): string;
  maybeSession(url: URL): Promise<void>;
}

type Req = IncomingMessage;
type Res = ServerResponse;

/** 提取 name 查询参数；缺失时写 400 并返回 undefined。 */
function requireNameParam(url: URL, res: Res): string | undefined {
  const name = queryParam(url, "name");
  if (name === undefined || name === "") {
    writeJson(res, 400, { error: "name query parameter is required" });
    return undefined;
  }
  return name;
}

// ------------------------------------------------------------ /config

/**
 * POST /config 接受的顶层键（M7 白名单）：客户端扁平 UI 形态，与
 * `normalizeUiConfig` 的**扁平**读键集同源（`ui`/`offset` 嵌套形态今天没有仓内调用方，
 * 不接受——否则白名单会退化成第三份形状定义）。
 */
const UI_CONFIG_KEYS: readonly string[] = [
  "position",
  "offsetX",
  "offsetY",
  "blankY",
  "zIndexBase",
];

/** UI 配置读写（GET 豁免 loopback；写操作 loopback-only，未知顶层键 400）。 */
export function buildConfigRoute(manager: RoutesManager, helpers: RouteHelpers): WebRoute {
  return {
    kind: "exact",
    path: ROUTES.config,
    handler: async (req: Req, res: Res) => {
      // GET：只读 UI 配置（允许非 loopback，供远程页面读取非敏感的展示配置）。
      if (ROUTE_FENCE.config.loopbackExempt.includes(String(req.method))) {
        try {
          writeJson(res, 200, manager.uiConfig());
        } catch (error) {
          helpers.handleError(res, error);
        }
        return;
      }
      // POST：写入浮窗 UI 配置（position / offsetX / offsetY / blankY / zIndexBase）。
      // 写操作只对 loopback 开放；经设置命名空间落盘（Config.ui），触发
      // scope.watch → onChange → SSE 广播一帧，客户端收到后重新 GET /config 就地更新
      // 浮窗位置，无需重启/轮询。
      //
      // M7：**未知顶层键一律 400 且不落盘**（校验在任何 uiUpdate 之前）。静默丢键会让
      // 调用方以为写入生效——错就要说错，不能把「没生效」写成 200。
      if (ROUTE_FENCE.config.guarded.includes(String(req.method))) {
        if (!guardLoopbackMethod(req, res, ROUTE_FENCE.config.guarded)) return;
        let body: unknown;
        try {
          body = await readJsonBody(req);
        } catch {
          writeJson(res, 400, { error: "invalid JSON body" });
          return;
        }
        if (typeof body !== "object" || body === null) {
          writeJson(res, 400, { error: "invalid JSON body" });
          return;
        }
        try {
          const rec = body as Record<string, unknown>;
          const unknownKeys = Object.keys(rec).filter((key) => !UI_CONFIG_KEYS.includes(key));
          if (unknownKeys.length > 0) {
            writeJson(res, 400, { error: `unknown config key(s): ${unknownKeys.join(", ")}` });
            return;
          }
          writeJson(res, 200, await manager.updateUiConfig(body));
        } catch (error) {
          helpers.handleError(res, error);
        }
        return;
      }
      // 端点级方法分流先于 loopback 的刻意例外（#473 R2 结构 β）：本分支对
      // 白名单外方法（PUT/DELETE/OPTIONS 等）直接 405、不查 loopback——非
      // loopback+PUT 返回 405 而非 403 是契约行为，禁止误套守卫（会漂移为 403）。
      writeJson(res, 405, { error: `method not allowed: ${req.method}` });
    },
  };
}

// ------------------------------------------------------------ /servers

/** 服务器集合变更（POST 添加 / PATCH 更新 / DELETE 删除）：写操作面，与 GET 快照分离。
 *
 * 回答「如何变更集合？」——读快照（GET）留在 handler 内，方法分流后写操作整体下沉。
 * 返回 true 表示已处理并应答；false 表示方法不在写集合内（调用方继续 405）。 */
async function handleServersMutation(
  method: string,
  url: URL,
  req: Req,
  res: Res,
  manager: RoutesManager,
  helpers: RouteHelpers,
): Promise<boolean> {
  if (method === "POST") {
    await createServer(req, res, manager, helpers);
    return true;
  }
  if (method !== "PATCH" && method !== "DELETE") return false;
  const name = requireNameParam(url, res);
  if (name === undefined) return true;
  await changeServer(method, name, url, req, res, manager, helpers);
  return true;
}

/** POST /servers：新增单台（201 + 投影 + 快照）。 */
async function createServer(
  req: Req,
  res: Res,
  manager: RoutesManager,
  helpers: RouteHelpers,
): Promise<void> {
  const body = await readJsonBody(req);
  if (body === undefined) {
    writeJson(res, 400, { error: "invalid JSON body" });
    return;
  }
  const { workspace } = apiPorts.get();
  try {
    const rec = body as Record<string, unknown>;
    const scope = workspace.normalizeScope(rec.scope as string);
    if (typeof rec.cwd === "string" && rec.cwd !== "") await manager.setSession(rec.cwd);
    const created = await manager.add(rec, scope);
    // #770-L3 只读投影：200 响应 server 字段不再明文回显写路径原文（与 A3 同一红线伞）。
    // 缺省回落原文：外部 RoutesManager 实现未提供 summarize 时自身无秘密可泄（同 redactError 兼容口径）。
    const server =
      typeof manager.summarize === "function" ? manager.summarize(created, scope) : created;
    writeJson(res, 201, { server, summary: manager.summary() });
  } catch (error) {
    helpers.handleError(res, error);
  }
}

/** PATCH /servers（更新）/ DELETE /servers（移除）：先 maybeSession 切会话再按方法分流。 */
async function changeServer(
  method: string,
  name: string,
  url: URL,
  req: Req,
  res: Res,
  manager: RoutesManager,
  helpers: RouteHelpers,
): Promise<void> {
  try {
    await helpers.maybeSession(url);
    const scope = helpers.scopeParam(url);
    if (method === "DELETE") {
      await manager.remove(name, scope);
      writeJson(res, 200, { ok: true, summary: manager.summary() });
      return;
    }
    const body = await readJsonBody(req);
    if (body === undefined) {
      writeJson(res, 400, { error: "invalid JSON body" });
      return;
    }
    const updated = await manager.update(name, body as Record<string, unknown>, scope);
    // #770-L3 只读投影：同 POST 分支（与 A3 同一红线伞；缺省回落原文口径同上）。
    const server =
      typeof manager.summarize === "function" ? manager.summarize(updated, scope) : updated;
    writeJson(res, 200, { server, summary: manager.summary() });
  } catch (error) {
    helpers.handleError(res, error);
  }
}

/** 服务器集合 CRUD：GET 快照（纯读）/ POST 添加 / PATCH 更新 / DELETE 删除。 */
export function buildServersRoute(manager: RoutesManager, helpers: RouteHelpers): WebRoute {
  return {
    kind: "exact",
    path: ROUTES.servers,
    handler: async (req: Req, res: Res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const method = req.method ?? "GET";
      if (!guardLoopbackMethod(req, res, ROUTE_FENCE.servers.guarded)) return;
      if (method === "GET") {
        try {
          // 变更点驱动（#111/#228）：GET /servers 是纯读快照，零副作用——
          // 磁盘变更由 fs.watch 事件驱动 reconcile，状态从内存 store 读。
          // 历史 refreshFromDisk 副作用（mtime 轮询 + reconcile）已移除。
          // cwd is resolved by the route factory into a request-owned view. It never calls setSession
          // or starts a connection. Declaration data is prepared at startup/configuration changes.
          // 多源展示面：在运行快照之上，合并四个声明来源的「全部声明条目」。
          // 同名多来源并存展示（用户要求的分组模型），互斥只决定哪一份运行：
          //   - 生效来源的条目 → 用运行快照里的真实状态（运行中/失败…）
          //   - 落选来源的条目 → stopped + shadowed 标记（面板显示未连接·互斥）
          // 运行面里不属任何来源的条目照旧透出（source 缺省 → 「其他」组）。
          const base = manager.summary() as Record<string, unknown>;
          const runtimeServers = (base.servers ?? []) as Record<string, unknown>[];
          try {
            const projectRoot = typeof base.projectRoot === "string" ? base.projectRoot : undefined;
            const snapshot = manager.sourceSnapshot?.();
            const parsedSources = manager.sourceSnapshot !== undefined ? snapshot?.sources ?? [] : SOURCE_IDS.map((sid) => {
              const p2 = sourcePath(sid, projectRoot);
              return parseSourceEntry(sid, p2, p2 === null ? null : readSourceFile(p2));
            });
            const prefs = snapshot?.prefs ?? (manager.sourceSnapshot !== undefined ? new Map<string, SourceId>() : await loadSourcePrefs());
            const eff = resolveEffective(parsedSources, prefs);
            const declared: Record<string, unknown>[] = [];
            const seen = new Set<string>();
            for (const entry of parsedSources) {
              for (const server of entry.servers) {
                const key = `${entry.id}#${server.name}`;
                if (seen.has(key)) continue;
                seen.add(key);
                const winner = eff.get(server.name);
                const isActive = winner !== undefined && winner.source === entry.id;
                const scope = sourceScope(entry.id);
                const runtime = runtimeServers.find((r) => r.name === server.name && r.scope === scope &&
                  (r.source === entry.id || (isActive && r.source === undefined)));
                // Shared global connections may remain live for other workspaces even when shadowed
                // here. Consume their declaration too; they are not a second, undeclared source.
                if (runtime !== undefined) runtimeServers.splice(runtimeServers.indexOf(runtime), 1);
                const safe = manager.summarize?.(server, scope) ?? server;
                if (isActive) {
                  declared.push({ ...safe, ...(runtime ?? { status: "stopped", tools: [] }), scope, source: entry.id });
                } else {
                  declared.push({
                    ...safe,
                    scope,
                    source: entry.id,
                    enabled: false,
                    status: "stopped",
                    tools: [],
                    shadowedBy: winner?.source ?? "",
                  });
                }
              }
            }
            base.servers = [...declared, ...runtimeServers];
            const counts: Record<string, number> = {};
            for (const server of base.servers as Record<string, unknown>[]) {
              if (server.shadowedBy !== undefined) continue;
              const status = String(server.status ?? "stopped");
              counts[status] = (counts[status] ?? 0) + 1;
            }
            base.counts = counts;
          } catch {
            /* 多源合并失败 → 回落纯运行快照 */
          }
          writeJson(res, 200, base);
        } catch (error) {
          helpers.handleError(res, error);
        }
        return;
      }
      if (await handleServersMutation(method, url, req, res, manager, helpers)) return;
      writeJson(res, 405, { error: `method not allowed: ${method}` });
    },
  };
}

// ------------------------------------------------------------ /session 与 /resume

/** 会话切换（跟随会话的项目级 MCP）。 */
export function buildSessionRoute(manager: RoutesManager, helpers: RouteHelpers): WebRoute {
  return {
    kind: "exact",
    path: ROUTES.session,
    handler: async (req: Req, res: Res) => {
      if (!guardLoopbackMethod(req, res, ROUTE_FENCE.session.guarded)) return;
      const body = await readJsonBody(req);
      if (body === undefined || typeof (body as Record<string, unknown>).cwd !== "string") {
        writeJson(res, 400, { error: "body must include a cwd string" });
        return;
      }
      try {
        await manager.setSession((body as Record<string, unknown>).cwd as string);
        writeJson(res, 200, { ok: true, summary: manager.summary() });
      } catch (error) {
        helpers.handleError(res, error);
      }
    },
  };
}

/** 解析 resume 可选请求体：回答「本次要固定哪个 root？」——形状与必填校验。
 *
 * 返回携带 cwd 的成功体（缺 cwd 即回落既有绑定），或写 400 用的错误文案；
 * 数组是合法 JSON 但不是请求体对象，同样拒绝且不触发恢复。 */
function parseResumeCwd(value: object): { ok: true; cwd?: string } | { ok: false; error: string } {
  if (Array.isArray(value)) return { ok: false, error: "invalid JSON body" };
  const rec = value as Record<string, unknown>;
  if (!("cwd" in rec)) return { ok: true };
  if (typeof rec.cwd !== "string") return { ok: false, error: "body cwd must be a string" };
  return { ok: true, cwd: rec.cwd };
}

/** 切回前台可用性恢复（非强制，#1120）：body 可选 { cwd?: string }。
 * - 无 body（旧客户端）：回落既有绑定，manager.resumeReconnect() 无参；
 * - 有 cwd（含 "")：本次固定 root（""=明确无工作区→@global，不回落他人绑定）；
 * - 非对象（含数组，readJsonBodyOutcome 把数组归 json 需此处拒）/ cwd 非字符串 → 400
 *   且不触发恢复。路径/围栏/方法分流不动。 */
export function buildResumeRoute(manager: RoutesManager, helpers: RouteHelpers): WebRoute {
  return {
    kind: "exact",
    path: ROUTES.resume,
    handler: async (req: Req, res: Res) => {
      if (!guardLoopbackMethod(req, res, ROUTE_FENCE.resume.guarded)) return;
      try {
        if (typeof manager.resumeReconnect !== "function")
          throw new Error("resumeReconnect unavailable");
        const outcome = await readJsonBodyOutcome(req);
        if (outcome.kind === "invalid") {
          writeJson(res, 400, { error: "invalid JSON body" });
          return;
        }
        if (outcome.kind === "absent") {
          await manager.resumeReconnect();
          writeJson(res, 200, { ok: true, summary: manager.summary() });
          return;
        }
        const parsed = parseResumeCwd(outcome.value);
        if (!parsed.ok) {
          writeJson(res, 400, { error: parsed.error });
          return;
        }
        if (parsed.cwd === undefined) {
          await manager.resumeReconnect();
        } else {
          await manager.resumeReconnect(parsed.cwd);
        }
        writeJson(res, 200, { ok: true, summary: manager.summary() });
      } catch (error) {
        helpers.handleError(res, error);
      }
    },
  };
}

// ------------------------------------------------------------ connect / disconnect / reconnect

/** 单服务器连接/断开/重连三兄弟路由（同构：name 必填 + maybeSession + scope）。 */
function buildNameActionRoute(
  route: RouteName,
  action: (name: string, scope: string) => Promise<void>,
  manager: RoutesManager,
  helpers: RouteHelpers,
): WebRoute {
  return {
    kind: "exact",
    path: ROUTES[route],
    handler: async (req: Req, res: Res) => {
      if (!guardLoopbackMethod(req, res, ROUTE_FENCE[route].guarded)) return;
      const url = new URL(req.url ?? "/", "http://localhost");
      const name = requireNameParam(url, res);
      if (name === undefined) return;
      try {
        await helpers.maybeSession(url);
        await action(name, helpers.scopeParam(url));
        writeJson(res, 200, { ok: true, summary: manager.summary() });
      } catch (error) {
        helpers.handleError(res, error);
      }
    },
  };
}

/** POST /servers/connect：连接单服务器。 */
export function buildConnectRoute(manager: RoutesManager, helpers: RouteHelpers): WebRoute {
  return buildNameActionRoute(
    "connect",
    (name, scope) => manager.connect(name, scope),
    manager,
    helpers,
  );
}

/** POST /servers/disconnect：断开单服务器。 */
export function buildDisconnectRoute(manager: RoutesManager, helpers: RouteHelpers): WebRoute {
  return buildNameActionRoute(
    "disconnect",
    (name, scope) => manager.disconnect(name, scope),
    manager,
    helpers,
  );
}

/** POST /servers/reconnect：重连单服务器。 */
export function buildReconnectRoute(manager: RoutesManager, helpers: RouteHelpers): WebRoute {
  return buildNameActionRoute(
    "reconnect",
    (name, scope) => manager.reconnect(name, scope),
    manager,
    helpers,
  );
}

// ------------------------------------------------------------ /import/json

/** 单台服务器的导入落点：在册且未开 overwrite → 记 skipped；在册开 overwrite → update；否则 add。 */
export async function importOneServer(
  server: ServerConfig,
  store: McpStore,
  scope: string,
  overwrite: boolean,
  manager: RoutesManager,
  imported: string[],
  skipped: string[],
): Promise<void> {
  if (store.find(server.name) === undefined) {
    await manager.add(server, scope);
    imported.push(server.name);
    return;
  }
  if (!overwrite) {
    skipped.push(server.name);
    return;
  }
  await manager.update(server.name, server, scope);
  imported.push(server.name);
}

/** 导入 mcpServers JSON（同名 skip，overwrite=true 时更新）。 */
export function buildImportJsonRoute(manager: RoutesManager, helpers: RouteHelpers): WebRoute {
  return {
    kind: "exact",
    path: ROUTES.importJson,
    handler: async (req: Req, res: Res) => {
      const { workspace, configModel } = apiPorts.get();
      if (!guardLoopbackMethod(req, res, ROUTE_FENCE.importJson.guarded)) return;
      const body = await readJsonBody(req);
      const rec0 = (body ?? {}) as Record<string, unknown>;
      if (typeof rec0.json !== "string" && typeof rec0.path !== "string") {
        writeJson(res, 400, { error: "body must include a json or path string" });
        return;
      }
      if (typeof rec0.json !== "string") {
        // path 导入：读 mcp.json 文件内容当作粘贴文本（支持 ~ 展开）；失败即 400，
        // 错误信息带原路径——比连接挂掉或笼统 500 离病因近得多。
        const filePath = (rec0.path as string).replace(/^~(?=\/|$)/, process.env.HOME ?? "");
        let text: string;
        try {
          text = await readFile(filePath, "utf8");
        } catch (error) {
          writeJson(res, 400, {
            error: `cannot read mcp.json at ${rec0.path as string}: ${error instanceof Error ? error.message : String(error)}`,
          });
          return;
        }
        rec0.json = text;
      }
      const imported: string[] = [];
      const skipped: string[] = [];
      try {
        const rec = rec0;
        const scope = workspace.normalizeScope(rec.scope as string);
        if (typeof rec.cwd === "string" && rec.cwd !== "") await manager.setSession(rec.cwd);
        const store = scope === SCOPE_PROJECT ? await manager.projectStoreOrThrow() : manager.store;
        const servers = configModel.parseClaudeJson(rec.json as string);
        for (const server of servers) {
          await importOneServer(
            server,
            store,
            scope,
            rec.overwrite === true,
            manager,
            imported,
            skipped,
          );
        }
      } catch (error) {
        helpers.handleError(res, error);
        return;
      }
      writeJson(res, 200, { imported, skipped, summary: manager.summary() });
    },
  };
}

// ------------------------------------------------------------ /tool-disable

/** 解析 tool-disable 请求体：回答「调用方要禁哪把工具？」——形状与必填校验。
 *
 * 返回携带 server/tool/disabled 的成功体，或写 400 用的错误文案；路由一致性
 * （全名 root 是否属于当前工作空间）与执行留在 handler 内（不同问题）。 */
function parseToolDisableBody(
  body: unknown,
): { ok: true; server: string; tool: string; disabled: boolean } | { ok: false; error: string } {
  if (body === undefined || typeof body !== "object" || body === null) {
    return { ok: false, error: "invalid JSON body" };
  }
  const rec = body as Record<string, unknown>;
  const server = typeof rec.server === "string" ? rec.server : "";
  const tool = typeof rec.tool === "string" ? rec.tool : "";
  const disabled = rec.disabled === true;
  if (server === "" || tool === "") {
    return { ok: false, error: "server 与 tool 均为必填" };
  }
  return { ok: true, server, tool, disabled };
}

/** 路由一致性校验：@global 或当前会话项目 root 才可写（防跨空间串台）。放行返回 null。 */
export function workspaceMismatchError(
  root: string,
  sessionRoot: string | undefined,
  server: string,
): string | null {
  if (root === MIDDLEWARE_GLOBAL_ROOT || root === sessionRoot) return null;
  return `server ${JSON.stringify(server)} 不属于当前工作空间；路由一致性校验失败（防跨空间串台）`;
}

/** 工具级禁用开关（PATCH；root 路由一致性校验防跨空间串台）。 */
export function buildToolDisableRoute(manager: RoutesManager, helpers: RouteHelpers): WebRoute {
  return {
    kind: "exact",
    path: ROUTES.toolDisable,
    handler: async (req: Req, res: Res) => {
      const { workspace } = apiPorts.get();
      if (!guardLoopbackMethod(req, res, ROUTE_FENCE.toolDisable.guarded)) return;
      const url = new URL(req.url ?? "/", "http://localhost");
      const body = await readJsonBody(req);
      const parsedBody = parseToolDisableBody(body);
      if (!parsedBody.ok) {
        writeJson(res, 400, { error: parsedBody.error });
        return;
      }
      const { server, tool, disabled } = parsedBody;
      // 路由一致性：server 全名 root 必须属于当前工作空间（或 @global）。
      const parsed = workspace.parseFullServerName(server);
      if (parsed === undefined) {
        writeJson(res, 400, { error: "server 格式非法，应为 @<root>/<server>" });
        return;
      }
      const root = parsed.root;
      const cwdParam = queryParam(url, "cwd");
      if (cwdParam !== undefined && cwdParam !== "") await manager.setSession(cwdParam);
      const mismatch = workspaceMismatchError(root, manager.projectRoot, server);
      if (mismatch !== null) {
        writeJson(res, 400, { error: mismatch });
        return;
      }
      if (typeof manager.setToolDisabled !== "function") {
        writeJson(res, 400, { error: "tool-disable not writable: middleware unavailable" });
        return;
      }
      try {
        // #392 遗留④：tool 参数先归一化（剥 mcp__<id>__ 直呼前缀）再入禁用表——
        // 旧客户端/手工 API 可能提交带前缀名，此前原样存键导致 guard 层查裸名不命中、
        // 禁用静默无效。跨 server 前缀（剥后仍 mcp__ 开头）由 normalizeToolName 抛错。
        const toolName = workspace.normalizeToolName(parsed.server, tool, "tool-disable");
        await manager.setToolDisabled(root, parsed.server, toolName, disabled);
        writeJson(res, 200, { ok: true, summary: manager.summary() });
      } catch (error) {
        helpers.handleError(res, error);
      }
    },
  };
}

// ------------------------------------------------------------ /sources（多源声明配置）

/** 读取 user-state 旁的互斥选择记忆（name → sourceId）；坏文件静默回落空表。 */
async function loadSourcePrefs(): Promise<Map<string, SourceId>> {
  try {
    const text = await readTextFile(sourcePrefsPath());
    const raw = JSON.parse(text ?? "{}");
    const rec = (raw ?? {}) as Record<string, unknown>;
    const out = new Map<string, SourceId>();
    for (const [name, id] of Object.entries(rec)) {
      if (typeof id === "string" && (SOURCE_IDS as readonly string[]).includes(id)) {
        out.set(name, id as SourceId);
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

/** 持久化互斥选择记忆（写失败仅告警返回 false——记忆丢失不该挡导入）。 */
function saveSourcePrefs(prefs: Map<string, SourceId>): boolean {
  try {
    writeFileAtomic(sourcePrefsPath(), `${JSON.stringify(Object.fromEntries(prefs), null, 2)}\n`);
    return true;
  } catch {
    return false;
  }
}

/** 四来源全量状态（面板渲染面）：路径 / 是否存在 / 原文 / 解析错误。 */
export function buildSourcesRoute(manager: RoutesManager, helpers: RouteHelpers): WebRoute {
  return {
    kind: "exact",
    path: ROUTES.sources,
    handler: async (req: Req, res: Res) => {
      const { workspace } = apiPorts.get();
      if (!guardLoopbackMethod(req, res, ROUTE_FENCE.sources.guarded)) return;
      const url = new URL(req.url ?? "/", "http://localhost");
      await helpers.maybeSession(url);
      const cwd = url.searchParams.get("cwd") ?? undefined;
      let projectRoot: string | undefined;
      try {
        projectRoot = cwd === undefined || cwd === "" ? undefined : await findProjectRoot(cwd);
      } catch {
        projectRoot = undefined;
      }
      const prefs = await loadSourcePrefs();
      const sources = SOURCE_IDS.map((id) => {
        const path = sourcePath(id, projectRoot ?? undefined);
        const parsed = parseSourceEntry(id, path, path === null ? null : readSourceFile(path));
        return {
          id,
          scope: sourceScope(id),
          // 无会话时项目来源 path 为 null：仍返回条目（客户端渲染空编辑器，
          // 保存时按当时会话解析路径并直接创建）。
          path,
          exists: parsed.exists,
          error: parsed.error ?? null,
          text: path === null ? null : readSourceFile(path),
        };
      });
      writeJson(res, 200, {
        sources,
        projectRoot: projectRoot ?? null,
        prefs: Object.fromEntries(prefs),
      });
    },
  };
}

/** 保存一个来源的 mcp.json（mkdir -p；随后互斥同步落运行面）。 */
export function buildSourceSaveRoute(manager: RoutesManager, helpers: RouteHelpers): WebRoute {
  return {
    kind: "exact",
    path: ROUTES.sourceSave,
    handler: async (req: Req, res: Res) => {
      const { workspace } = apiPorts.get();
      if (!guardLoopbackMethod(req, res, ROUTE_FENCE.sourceSave.guarded)) return;
      const body = await readJsonBody(req);
      const rec = (body ?? {}) as Record<string, unknown>;
      const id = rec.id as SourceId;
      if (typeof id !== "string" || !(SOURCE_IDS as readonly string[]).includes(id)) {
        writeJson(res, 400, { error: "body must include a valid source id" });
        return;
      }
      if (typeof rec.text !== "string") {
        writeJson(res, 400, { error: "body must include a text string" });
        return;
      }
      const cwd = typeof rec.cwd === "string" && rec.cwd !== "" ? rec.cwd : undefined;
      let projectRoot: string | undefined;
      try {
        projectRoot = cwd === undefined ? undefined : await findProjectRoot(cwd);
      } catch {
        projectRoot = undefined;
      }
      // 请求缺 cwd 时回落 manager 当前会话的项目根：浮层/弹层动作按钮发出时
      // 会话读数可能尚未就绪，缺省不该让 activate/save 误判「来源未声明」。
      if (projectRoot === undefined) projectRoot = manager.projectRoot ?? undefined;
      const path = sourcePath(id, projectRoot);
      if (path === null) {
        writeJson(res, 400, { error: `source ${id} requires a project session` });
        return;
      }
      try {
        // 先解析后写：坏 JSON 不落盘，错误回传面板（离病因最近）。
        const parsed = parseSourceEntry(id, path, rec.text);
        if (parsed.error !== undefined) {
          writeJson(res, 400, { error: parsed.error });
          return;
        }
        writeSourceFile(path, rec.text);
      } catch (error) {
        writeJson(res, 400, {
          error: `cannot write ${path}: ${error instanceof Error ? error.message : String(error)}`,
        });
        return;
      }
      if (typeof rec.cwd === "string" && rec.cwd !== "") await manager.setSession(rec.cwd);
      const prefs = await loadSourcePrefs();
      const scoped = manager.forWorkspace !== undefined ? await manager.forWorkspace(cwd ?? manager.projectRoot) : manager;
      const globalSummary = sourceScope(id) === "global" ? await syncSourcesIntoManager(scoped, undefined, prefs) : undefined;
      const summary = projectRoot === undefined ? globalSummary ?? await syncSourcesIntoManager(scoped, undefined, prefs)
        : await syncSourcesIntoManager(scoped, projectRoot, prefs);
      if (projectRoot !== undefined && globalSummary !== undefined) {
        summary.effective.unshift(...globalSummary.effective);
        summary.removed.unshift(...globalSummary.removed);
        summary.warnings.unshift(...globalSummary.warnings);
      }
      await manager.sourcesChanged?.();
      writeJson(res, 200, { ok: true, path, ...summary });
    },
  };
}

/** 显式改选同名生效来源（互斥裁决的记忆位），随后同步。 */
export function buildSourceActivateRoute(manager: RoutesManager, helpers: RouteHelpers): WebRoute {
  return {
    kind: "exact",
    path: ROUTES.sourceActivate,
    handler: async (req: Req, res: Res) => {
      const { workspace } = apiPorts.get();
      if (!guardLoopbackMethod(req, res, ROUTE_FENCE.sourceActivate.guarded)) return;
      // 诊断面：activate 全程落 sync-debug.log（此前失败只进浏览器 console，无从排查）。
      const activateTrace = async (line: string): Promise<void> => {
        try {
          const { appendFileSync } = await import("node:fs");
          const { homedir } = await import("node:os");
          const { join } = await import("node:path");
          const p = join(homedir(), ".dsh", "dsh-mcp-manager", "sync-debug.log");
          appendFileSync(p, `[${new Date().toISOString()}] activate ${line}\n`);
        } catch {
          /* 日志失败不影响请求 */
        }
      };
      try {
      const body = await readJsonBody(req);
      const rec = (body ?? {}) as Record<string, unknown>;
      const id = rec.id as SourceId;
      const name = typeof rec.name === "string" ? rec.name : "";
      await activateTrace(`enter name=${name} id=${String(id)} cwd=${String(rec.cwd)}`);
      if (typeof id !== "string" || !(SOURCE_IDS as readonly string[]).includes(id) || name === "") {
        writeJson(res, 400, { error: "body must include a valid source id and name" });
        return;
      }
      const cwd = typeof rec.cwd === "string" && rec.cwd !== "" ? rec.cwd : undefined;
      let projectRoot: string | undefined;
      try {
        projectRoot = cwd === undefined ? undefined : await findProjectRoot(cwd);
      } catch {
        projectRoot = undefined;
      }
      // 同上：缺 cwd 回落 manager 当前会话的项目根。
      if (projectRoot === undefined) projectRoot = manager.projectRoot ?? undefined;
      // 只接受真的声明了此名的来源；否则记忆写进去也是空转。
      const parsed = parseSourceEntry(
        id,
        sourcePath(id, projectRoot),
        (() => {
          const p = sourcePath(id, projectRoot);
          return p === null ? null : readSourceFile(p);
        })(),
      );
      if (!parsed.servers.some((server) => server.name === name)) {
        writeJson(res, 400, { error: `source ${id} does not declare server "${name}"` });
        return;
      }
      const prefs = await loadSourcePrefs();
      prefs.set(name, id);
      const persisted = saveSourcePrefs(prefs);
      if (typeof rec.cwd === "string" && rec.cwd !== "") await manager.setSession(rec.cwd);
      const scoped = manager.forWorkspace !== undefined ? await manager.forWorkspace(cwd ?? manager.projectRoot) : manager;
      const globalSummary = sourceScope(id) === "global" ? await syncSourcesIntoManager(scoped, undefined, prefs) : undefined;
      const summary = projectRoot === undefined ? globalSummary ?? await syncSourcesIntoManager(scoped, undefined, prefs)
        : await syncSourcesIntoManager(scoped, projectRoot, prefs);
      if (projectRoot !== undefined && globalSummary !== undefined) {
        summary.effective.unshift(...globalSummary.effective);
        summary.removed.unshift(...globalSummary.removed);
        summary.warnings.unshift(...globalSummary.warnings);
      }
      await manager.sourcesChanged?.();
      // 显式改选 = 用户明确要这份跑：同步后对胜者 scope 做一次 connect
      //（清 userDisabled + force 重建），避免历史禁用痕把新胜者拦成 stopped。
      try {
        await scoped.connect(name, sourceScope(id));
      } catch (error) {
        await activateTrace(`post-sync connect failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      await activateTrace(`ok name=${name} id=${String(id)}`);
      writeJson(res, 200, { ok: true, persisted, ...summary });
      } catch (error) {
        await activateTrace(`FAILED: ${error instanceof Error ? error.message : String(error)}`);
        writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      }
    },
  };
}
