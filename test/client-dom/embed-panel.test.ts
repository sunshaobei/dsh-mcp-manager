// @vitest-environment happy-dom
/**
 * dsh-mcp-manager — 嵌入面板（左侧导航 / 设置页）直测。
 *
 * 守的事实：面板顶部有工作区下拉（仅全局 + registry 工作区），选择后后续请求
 * 带 cwd；面板复用现有服务器列表而不是另起一套。
 */
import * as React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EmbeddedMcpPanel } from "../../src/client/embed/panel.tsx";
import { createState } from "../../src/client/core/state.ts";
import { bindLocale, setFallbackDict } from "../../src/vendor/shared/client/i18n.js";
import { zh } from "../../src/client/locales.ts";

const realFetch = globalThis.fetch;
let urls: string[] = [];

function installFetch(): void {
  globalThis.fetch = (async (input: unknown): Promise<unknown> => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/workspaces")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          workspaces: [
            { id: "w1", name: "项目甲", path: "/tmp/proj-a" },
            { id: "w2", name: "项目乙", path: "/tmp/proj-b" },
          ],
        }),
      };
    }
    if (url.includes("/servers")) {
      return { ok: true, status: 200, json: async () => ({ servers: [], counts: {} }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  urls = [];
  installFetch();
  setFallbackDict(zh as unknown as Record<string, string>);
  bindLocale(undefined, "mcpManager");
});
afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
});

function baseState() {
  const state = createState();
  state.currentCwd = "/tmp/proj-a";
  state.sessionResolved = true;
  return state;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("EmbeddedMcpPanel", () => {
  it("渲染工作区下拉（仅全局 + registry），默认选中当前会话工作区", async () => {
    render(React.createElement(EmbeddedMcpPanel, { baseState: baseState() }));
    await flush();
    const select = document.querySelector<HTMLSelectElement>(".dm-embed-select");
    expect(select).not.toBeNull();
    expect([...select!.options].map((option) => option.textContent)).toEqual([
      "仅全局",
      "项目甲",
      "项目乙",
    ]);
    expect(select!.value).toBe("/tmp/proj-a");
    expect(document.querySelector(".dm-head h2")?.textContent).toBe("MCP 管理器");
  });

  it("切换工作区后用新 cwd 重新拉取服务器列表", async () => {
    render(React.createElement(EmbeddedMcpPanel, { baseState: baseState() }));
    await flush();
    const select = document.querySelector<HTMLSelectElement>(".dm-embed-select")!;
    await act(async () => {
      fireEvent.change(select, { target: { value: "/tmp/proj-b" } });
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(urls.some((url) => url.includes("/servers") && url.includes("cwd=%2Ftmp%2Fproj-b"))).toBe(
      true,
    );
  });
});
