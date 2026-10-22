/**
 * dsh-mcp-manager — unit：mcpServers JSON 导入解析（import.ts）。
 *
 * 覆盖：
 * - parseClaudeJson：裸 { name: config } 与 { mcpServers: {...} } 包裹两种形态
 * - 名称策略：合法名（含内部空格）原样保留；仍非法的名字折叠兜底；冲突加序号
 */
import { describe, expect, it } from "vitest";
import { normalizeEntryName, parseClaudeJson } from "../../src/server/config/import.ts";

describe("parseClaudeJson", () => {
  it("解析裸 { name: config } 形态", () => {
    const servers = parseClaudeJson(JSON.stringify({ a: { command: "node" } }));
    expect(servers).toHaveLength(1);
    expect(servers[0]?.name).toBe("a");
    expect(servers[0]?.transport).toBe("stdio");
  });

  it("自动解包 { mcpServers: {...} } 顶层包裹", () => {
    const wrapped = { mcpServers: { "test-stdio": { command: "npx" }, remote: { url: "https://x/mcp" } } };
    const servers = parseClaudeJson(JSON.stringify(wrapped));
    expect(servers.map((s) => s.name)).toEqual(["test-stdio", "remote"]);
  });

  it("带内部空格的合法名原样保留（不折叠成连字符）", () => {
    const servers = parseClaudeJson(
      JSON.stringify({ mcpServers: { "Figma AI Bridge": { command: "npx" } } }),
    );
    expect(servers[0]?.name).toBe("Figma AI Bridge");
  });
});

describe("normalizeEntryName", () => {
  it("合法名原样通过", () => {
    expect(normalizeEntryName("Figma AI Bridge", new Set())).toBe("Figma AI Bridge");
    expect(normalizeEntryName("gitlabmcp", new Set())).toBe("gitlabmcp");
  });

  it("仍非法的名字折叠兜底", () => {
    expect(normalizeEntryName("a/b:c", new Set())).toBe("a-b-c");
    expect(normalizeEntryName("///", new Set())).toBe("server");
  });

  it("与已用名冲突时追加序号", () => {
    expect(normalizeEntryName("x", new Set(["x"]))).toBe("x-2");
    expect(normalizeEntryName("x", new Set(["x", "x-2"]))).toBe("x-3");
  });
});
