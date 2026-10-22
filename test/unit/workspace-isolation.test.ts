import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpManager } from "../../src/server/connection/orchestrator/interface.ts";
import type { IncomingMessage } from "node:http";
import { makeRoutes, ROUTES } from "../../src/server/api/interface.ts";
import { parseSourceEntry } from "../../src/server/config/sources.ts";
import { callHandler } from "../helpers.ts";
import type { Context } from "@deepseek-ai/cordis";
import type { ToolDefinition, ToolExecution } from "@deepseek-ai/dsh-tools";
import { registerMiddlewareTools } from "../../src/server/inject/interface.ts";
import { McpStore, loadUserState } from "../../src/server/store/interface.ts";
import { normalizeServer } from "../../src/server/config/interface.ts";
import { fakeManagerCtx, installCompositionPorts, releaseCompositionPorts } from "../helpers.ts";

let dir: string;
let previousDshHome: string | undefined;
let manager: McpManager;
beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "dsh-workspace-isolation-"));
  previousDshHome = process.env.DSH_HOME;
  process.env.DSH_HOME = dir;
  installCompositionPorts();
  const store = new McpStore(join(dir, "global.config"));
  store.upsert(normalizeServer({ name: "shared", transport: "stdio", command: "echo" }));
  await store.save();
  manager = new McpManager(fakeManagerCtx(), store);
  manager.userStatePath = join(dir, "user-state.json");
  await manager.initMiddleware();
});
afterEach(async () => {
  await manager.dispose();
  releaseCompositionPorts();
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
  if (previousDshHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousDshHome;
});
function workspace(name: string): string {
  const path = join(dir, name);
  mkdirSync(join(path, ".git"), { recursive: true });
  return path;
}

describe("workspace snapshots and global MCP switches", () => {
  it("a shadowed global declaration is not repeated as an undeclared runtime source", async () => {
    const a = workspace("a");
    manager.store.find("shared")!.source = "global-agents";
    manager.store.find("shared")!.env = { API_TOKEN: "${WORKSPACE_TOKEN}" };
    const view = await manager.forWorkspace(a);
    view.projectStore!.upsert(normalizeServer({ name: "shared", transport: "stdio", command: "project-command", source: "project-agents" }));
    manager.sourceSnapshot = () => ({ prefs: new Map(), sources: [
      parseSourceEntry("global-agents", join(dir, "global.json"), JSON.stringify({ mcpServers: { shared: { command: "echo", env: { API_TOKEN: "${WORKSPACE_TOKEN}" } } } })),
      parseSourceEntry("project-agents", join(a, "project.json"), JSON.stringify({ mcpServers: { shared: { command: "project-command" } } })),
    ] });
    const route = makeRoutes(manager).find(route => route.path === ROUTES.servers)!;
    const result = await callHandler(route, { method: "GET", url: `${ROUTES.servers}?cwd=${encodeURIComponent(a)}`,
      headers: { host: "127.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage);
    expect(result.status).toBe(200);
    const payload = result.payload as { servers: Array<{ name: string; source?: string; scope: string; shadowedBy?: string }> };
    expect(payload.servers).toHaveLength(2);
    expect(payload.servers.map(server => server.source)).toEqual(["global-agents", "project-agents"]);
    expect(payload.servers[0]!.shadowedBy).toBe("project-agents");
    expect(payload.servers[0]!.scope).toBe("global");
    expect(JSON.stringify(payload)).not.toContain("API_TOKEN");
    expect(manager.store.find("shared")).toBeDefined();
  });

  it("A's global switch does not change B or the shared declaration, and survives restart", async () => {
    const a = workspace("a");
    const b = workspace("b");
    const before = readFileSync(manager.store.path, "utf8");
    const viewA = await manager.forWorkspace(a);
    const viewB = await manager.forWorkspace(b);
    await viewA.update("shared", { enabled: false }, "global");
    expect(viewA.globalEnabledFor(a, "shared")).toBe(false);
    expect(viewB.globalEnabledFor(b, "shared")).toBe(true);
    expect(viewA.summarize(manager.store.find("shared")!, "global").enabled).toBe(false);
    expect(viewB.summarize(manager.store.find("shared")!, "global").enabled).toBe(true);
    expect(manager.projectRoot).toBeUndefined();
    expect(readFileSync(manager.store.path, "utf8")).toBe(before);
    const persisted = await loadUserState(manager.userStatePath);
    expect(persisted.get(a)?.has("@global/shared")).toBe(true);
    manager.disabledByRoot = persisted;
    expect(manager.globalEnabledFor(a, "shared")).toBe(false);
    expect(manager.globalEnabledFor(b, "shared")).toBe(true);
  });

  it("workspace switches gate search, list, detail and call without disconnecting the shared transport", async () => {
    const a = workspace("a");
    const b = workspace("b");
    const server = manager.store.find("shared")!;
    server.toolDefinitions = [{ name: "ping", description: "ping", parameters: {}, execute: async () => "pong" }];
    const mw = manager.middleware!;
    await mw.projectUnitFor("@global");
    await mw.ensureConnected("@global", "shared");
    const connection = mw.units.get("@global")!.connections.get("shared");
    const viewA = await manager.forWorkspace(a);
    await viewA.update("shared", { enabled: false });
    let caller = a;
    const defs: ToolDefinition[] = [];
    const ctx = { tools: { register: (def: ToolDefinition) => { defs.push(def); return () => {}; } }, on: () => () => {} } as unknown as Context;
    const dispose = registerMiddlewareTools(ctx, mw, async () => caller);
    const exec = () => ({ callId: "test", signal: new AbortController().signal,
      agent: { session: { header: { cwd: caller } } } }) as unknown as ToolExecution;
    const run = (name: string, args: object) => defs.find(def => def.name === name)!.execute(args, exec());
    expect((await run("ws_mcp_search", {}) as { results: unknown[] }).results).toEqual([]);
    expect((await run("ws_mcp_list", {}) as { servers: unknown[] }).servers).toEqual([]);
    await expect(run("ws_mcp_detail", { server: "@@global/shared", tool: "ping" })).rejects.toThrow("停用");
    await expect(run("ws_mcp_call", { server: "@@global/shared", tool: "ping" })).rejects.toThrow("停用");
    caller = b;
    expect((await run("ws_mcp_search", {}) as { results: unknown[] }).results).toHaveLength(1);
    expect((await run("ws_mcp_list", {}) as { servers: unknown[] }).servers).toHaveLength(1);
    expect((await manager.catalogServersFor(a)).has("shared")).toBe(false);
    expect((await manager.catalogServersFor(b)).has("shared")).toBe(true);
    expect(mw.units.get("@global")!.connections.get("shared")).toBe(connection);
    dispose();
  });

  it("warmed workspace switches perform no disk reload or connection checks, even with a hung MCP", async () => {
    const a = workspace("a");
    const b = workspace("b");
    const viewA = await manager.forWorkspace(a);
    const viewB = await manager.forWorkspace(b);
    const reload = vi.spyOn(manager.store, "reloadIfChanged");
    const reloadA = vi.spyOn(viewA.projectStore!, "reloadIfChanged");
    const reloadB = vi.spyOn(viewB.projectStore!, "reloadIfChanged");
    const connection = vi.spyOn(manager.middleware!, "projectUnitFor").mockImplementation(() => new Promise(() => {}));
    // The production background hook returns a prepared task. It is never awaited by selection.
    manager.prepareWorkspace = () => new Promise(() => {});
    for (let i = 0; i < 20; i++) {
      await manager.setSession(i % 2 ? a : b);
      manager.summary();
    }
    expect(connection).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    expect(reloadA).not.toHaveBeenCalled();
    expect(reloadB).not.toHaveBeenCalled();
  });

  it("request-owned views retain their own project data while the selected session changes", async () => {
    const a = workspace("a");
    const b = workspace("b");
    const viewA = await manager.forWorkspace(a);
    const viewB = await manager.forWorkspace(b);
    viewA.projectStore!.upsert(normalizeServer({ name: "only-a", command: "echo", transport: "stdio", enabled: false }));
    viewB.projectStore!.upsert(normalizeServer({ name: "only-b", command: "echo", transport: "stdio", enabled: false }));
    manager.prepareWorkspace = async () => {};
    await manager.setSession(b);
    expect(viewA.summary().projectRoot).toBe(a);
    expect(viewB.summary().projectRoot).toBe(b);
    expect((viewA.summary().servers as { name: string }[]).map(s => s.name)).toEqual(["shared", "only-a"]);
    expect((viewB.summary().servers as { name: string }[]).map(s => s.name)).toEqual(["shared", "only-b"]);
  });
});
