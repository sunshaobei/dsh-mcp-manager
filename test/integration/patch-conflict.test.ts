/**
 * dsh-mcp-manager — 与 DSH 内置 MCP 管理器的共存门禁。
 *
 * DSH >= 0.2.2 的 web 组合自带 entry `mcp-manager`
 * （`@deepseek-ai/dsh-mcp-manager`），它注册的 cordis 服务名恰好是 `mcpManager`。
 * 本包的组合根也 `ctx.provide("mcpManager", …)`，两个 bundle 同时挂载时后激活的
 * 一方会因「service already registered」整条激活失败（2026-11 桌面端实测：插件
 * 在插件列表里显示异常、MCP 面板消失）。
 *
 * 修复方式是本 bundle patch 先按 id 停用内置行，再插入本包行；patch 方言规定
 * 匹配不到行的 id 目标只会告警并跳过，所以旧宿主上同样安全。这里锁住该顺序：
 * 停用行必须出现在 insert 之前，且服务名不得再与内置方冲突。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pkgDir = fileURLToPath(new URL("../../", import.meta.url));
const patch = readFileSync(join(pkgDir, "cordis.patch.yml"), "utf8");

describe("与内置 mcp-manager 共存", () => {
  it("patch 先停用内置 entry mcp-manager，再插入本包", () => {
    const disable = patch.search(/^- id: mcp-manager$/m);
    const insert = patch.search(/^\s*- id: dsh-mcp-manager$/m);
    expect(disable).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(disable);
    expect(patch.slice(disable)).toMatch(
      /^- id: mcp-manager\n\s+disabled: true$/m,
    );
  });

  it("仍以 @sunshaobei/dsh-mcp-manager 作为插入行 name", () => {
    expect(patch).toContain("name: '@sunshaobei/dsh-mcp-manager'");
  });
});
