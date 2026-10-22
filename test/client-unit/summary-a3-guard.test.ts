/**
 * dsh-mcp-manager — client-unit：#770-L2 迁移丢秘密大声失败（performSaveRequest 面）。
 *
 * 手填表单链（saveForm / isProjectionValue）已随 v0.4.0 移除：保存一律走
 * performSaveRequest（添加/编辑经多源 mcp.json 编辑器）。本文件锁其上的 M7 中止语义：
 * 改名/改归属迁移且原条目有秘密时**无条件中止**，零请求、保留编辑态、文案指引手动路径。
 * 宿主侧的占位符回写 guard（stripProjectionPatch）由 test/unit/summary-a3.test.ts 锁。
 *
 * 离线，无落盘。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { performSaveRequest } from "../../src/client/float/quick-add.ts";
import type { McpState } from "../../src/client/core/state.ts";
import { bindLocale } from "../../src/vendor/shared/client/i18n.js";

describe("#770-L2 迁移丢秘密大声失败", () => {
  const origFetch = globalThis.fetch;
  const origWindow = (globalThis as Record<string, unknown>).window;

  afterEach(() => {
    globalThis.fetch = origFetch;
    (globalThis as Record<string, unknown>).window = origWindow;
    // 恢复 t 回落（下组 fake locale 只在本 describe 内生效，不污染他组）。
    bindLocale({ bind: () => (key: string) => key }, "dsh-mcp-manager");
    vi.restoreAllMocks();
  });

  /** 装配透传 msg 的 fake locale，使 alert 文案可断言（t 回落时 params 被吞）。 */
  function installMsgCaptureT(): void {
    bindLocale(
      {
        bind: () => (key: string, params?: Record<string, unknown>) =>
          `${key}::${String((params as { msg?: unknown } | undefined)?.msg ?? "")}`,
      },
      "dsh-mcp-manager",
    );
  }

  /** 编辑态最小面：editingName 与 editing 分叉即 migrated（scope 由 projectRoot 回落）。 */
  function makeState(editing: unknown, projectRoot = ""): McpState {
    return {
      editingName: "old-name",
      editing,
      API: { servers: "/api/dsh-mcp/servers" },
      projectRoot,
      currentCwd: "",
    } as unknown as McpState;
  }

  it("migrated && editing.hasSecrets 时 alert 中止且不发请求（文案指引手动路径）", async () => {
    installMsgCaptureT();
    const alert = vi.fn();
    (globalThis as Record<string, unknown>).window = { alert };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const state = makeState({ name: "old-name", scope: "global", hasSecrets: true });
    // server.name new-name 与 editingName old-name 分叉即 migrated。
    const ok = await performSaveRequest(
      state,
      { name: "new-name", transport: "stdio" },
      { name: "new-name", scope: "global" },
    );
    expect(ok).toBe(false);
    expect(alert).toHaveBeenCalledTimes(1);
    const shown = String(alert.mock.calls[0]?.[0] ?? "");
    expect(shown.startsWith("saveFail")).toBe(true);
    // L2 文案锁：指引手动路径（新建同名条目填真值后删旧条目），不得承诺“重填后保存”
    // （无条件拦截下该后续路径不存在，旧文案误导）。
    expect(shown).toContain("新建同名条目");
    expect(shown).toContain("真实凭据");
    expect(shown).toContain("删除旧条目");
    expect(shown).not.toContain("后再保存");
    expect(fetchMock).not.toHaveBeenCalled();
    // 中止即保留编辑态。
    expect(state.editingName).toBe("old-name");
  });

  it("无条件拦截：hasSecrets 判定不因 payload 是否带值而松动（fail-closed）", async () => {
    installMsgCaptureT();
    const alert = vi.fn();
    (globalThis as Record<string, unknown>).window = { alert };
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const state = makeState({ name: "old-name", scope: "global", hasSecrets: true });
    // payload 带自认的真值 env——仍须拦截（有无填值不改变 hasSecrets 判定）。
    const ok = await performSaveRequest(
      state,
      { name: "new-name", transport: "stdio" },
      { name: "new-name", scope: "global", env: { MY_TOKEN: "user-filled-real-value" } },
    );
    expect(ok).toBe(false);
    expect(alert).toHaveBeenCalledTimes(1);
    expect(String(alert.mock.calls[0]?.[0] ?? "")).toContain("新建同名条目");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.editingName).toBe("old-name");
  });

  it("migrated 但无秘密时正常走 POST+DELETE（不误拦）", async () => {
    const alert = vi.fn();
    (globalThis as Record<string, unknown>).window = { alert };
    const fetchMock = vi.fn(async (_input: unknown) => ({
      ok: true,
      json: async () => ({}),
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const state = makeState({ name: "old-name", scope: "global", hasSecrets: false });
    const ok = await performSaveRequest(
      state,
      { name: "new-name", transport: "stdio" },
      { name: "new-name", scope: "global" },
    );
    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0] ?? "")).toBe("/api/dsh-mcp/servers");
  });
});
