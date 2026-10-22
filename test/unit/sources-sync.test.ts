import { mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeManagerCtx, installCompositionPorts, releaseCompositionPorts } from "../helpers.ts";
import { McpManager } from "../../src/server/connection/orchestrator/interface.ts";
import { McpStore } from "../../src/server/store/interface.ts";
import { normalizeServer } from "../../src/server/config/interface.ts";
import { syncSourcesIntoManager } from "../../src/server/config/sources-sync.ts";

const fixture = vi.hoisted(() => ({ home: "" }));
vi.mock("node:os", async (original) => ({
  ...await original<typeof import("node:os")>(),
  homedir: () => fixture.home,
}));

let previousHome: string | undefined;
let manager: McpManager;
beforeEach(async () => {
  fixture.home = mkdtempSync(join(tmpdir(), "dsh-source-sync-"));
  previousHome = process.env.DSH_HOME;
  process.env.DSH_HOME = join(fixture.home, ".dsh");
  installCompositionPorts();
  const store = new McpStore(join(process.env.DSH_HOME, "dsh-mcp-manager.config"));
  await store.load();
  manager = new McpManager(fakeManagerCtx(), store);
  // 本测试验证配置同步，不启动网络连接或子进程。
  vi.spyOn(manager, "start").mockImplementation(() => {});
});
afterEach(async () => {
  await manager.dispose();
  releaseCompositionPorts();
  vi.restoreAllMocks();
  if (previousHome === undefined) delete process.env.DSH_HOME;
  else process.env.DSH_HOME = previousHome;
  rmSync(fixture.home, { recursive: true, force: true });
});

function declareServer(command: string) {
  const path = join(fixture.home, ".agents", "mcp.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ mcpServers: { shared: { command } } }));
}

describe("来源同步不重建未变化的连接", () => {
  it("source 字段键序不同仍视为相同，重复同步不 update、不重写配置", async () => {
    declareServer("echo");
    manager.store.upsert(normalizeServer({
      name: "shared", transport: "stdio", command: "echo", source: "global-agents",
    }));
    await manager.store.save();
    const update = vi.spyOn(manager, "update");
    const originalFile = statSync(manager.store.path);
    for (let i = 0; i < 3; i++) {
      const result = await syncSourcesIntoManager(manager);
      expect(result.effective).toHaveLength(1);
      expect(result.warnings.filter((warning) => !warning.startsWith("无项目会话"))).toEqual([]);
    }
    expect(update).not.toHaveBeenCalled();
    expect(manager.start).not.toHaveBeenCalled();
    const currentFile = statSync(manager.store.path);
    expect(currentFile.ino).toBe(originalFile.ino);
    expect(currentFile.mtimeMs).toBe(originalFile.mtimeMs);
  });

  it("真实配置变化更新一次，后续同步复用", async () => {
    declareServer("echo");
    await syncSourcesIntoManager(manager);
    const update = vi.spyOn(manager, "update");
    declareServer("cat");
    await syncSourcesIntoManager(manager);
    await syncSourcesIntoManager(manager);
    expect(update).toHaveBeenCalledTimes(1);
    expect(manager.store.find("shared")?.command).toBe("cat");
  });
  it("project source projection does not delete a global declaration needed by another workspace", async () => {
    declareServer("global-command");
    await syncSourcesIntoManager(manager);
    const a = join(fixture.home, "a");
    const b = join(fixture.home, "b");
    for (const root of [a, b]) mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(a, ".agents"), { recursive: true });
    writeFileSync(join(a, ".agents", "mcp.json"), JSON.stringify({ mcpServers: { shared: { command: "project-command" } } }));
    const viewA = await manager.forWorkspace(a);
    const viewB = await manager.forWorkspace(b);
    await syncSourcesIntoManager(viewA, a);
    await syncSourcesIntoManager(viewB, b);
    expect(manager.store.find("shared")?.command).toBe("global-command");
    expect(viewA.projectStore!.find("shared")?.command).toBe("project-command");
    expect(viewB.projectStore!.find("shared")).toBeUndefined();
    expect((await manager.catalogServersFor(a)).get("shared")?.server.command).toBe("project-command");
    expect((await manager.catalogServersFor(b)).get("shared")?.server.command).toBe("global-command");
  });

});
