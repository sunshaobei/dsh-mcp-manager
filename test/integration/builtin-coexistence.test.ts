/**
 * dsh-mcp-manager — 与 DSH 内置 MCP 管理器的共存门禁。
 *
 * DSH >= 0.2.2 的 web 组合自带 entry `mcp-manager`
 * （`@deepseek-ai/dsh-mcp-manager`），它注册的 cordis 服务名是 `mcpManager`。
 * 本插件的组合根同样对外提供 MCP 管理服务，因此：
 *   1. 不得在 bundle patch 里停用官方 `mcp-manager` 行（不改变宿主能力）；
 *   2. 自己的服务名必须是 `mcpManagerPro`，不得再 provide 官方占用的 `mcpManager`。
 *
 * 两条任一被破坏都会回到 2026-11 桌面端的事故：后激活的一方因
 * 「service already registered」整条插件激活失败，MCP 面板消失并显示异常。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pkgDir = fileURLToPath(new URL("../../", import.meta.url));
const patch = readFileSync(join(pkgDir, "cordis.patch.yml"), "utf8");
const entry = readFileSync(join(pkgDir, "src", "index.ts"), "utf8");

describe("与内置 mcp-manager 共存", () => {
  it("bundle patch 只插入本插件，不停用宿主自带的 mcp-manager 行", () => {
    expect(patch).toContain("id: dsh-mcp-manager");
    expect(patch).not.toMatch(/^- id: mcp-manager$/m);
    expect(patch).not.toMatch(/disabled:\s*true/);
  });

  it("服务名是 mcpManagerPro，不占用官方的 mcpManager", () => {
    expect(entry).toContain('const MCP_MANAGER_SERVICE = "mcpManagerPro" as const');
    expect(entry).toContain('ctx.provide("mcpManagerPro", {');
    expect(entry).not.toContain('ctx.provide("mcpManager", {');
  });
});
