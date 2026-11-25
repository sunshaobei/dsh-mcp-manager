/**
 * dsh-mcp-manager — 文件导入合并纯函数判据。
 *
 * 守的事实：已有内容解析失败不覆盖；同名保留已有并计入 skipped；新名追加；
 * 顶层其它键（$schema 等）保留。
 */
import { describe, expect, it } from "vitest";
import { mergeMcpServersJson } from "../../src/client/float/import-file.ts";

describe("mergeMcpServersJson", () => {
  it("空文件 + 导入 → 全部新增", () => {
    const out = mergeMcpServersJson(null, JSON.stringify({ a: { command: "a" } }));
    expect(out).toMatchObject({ ok: true, added: 1, skipped: 0 });
    expect(JSON.parse(out.text!)).toEqual({ mcpServers: { a: { command: "a" } } });
  });

  it("同名保留已有配置，只追加新名", () => {
    const existing = JSON.stringify({
      mcpServers: {
        a: { command: "old-a" },
        keep: { command: "keep" },
      },
    });
    const imported = JSON.stringify({
      mcpServers: {
        a: { command: "new-a" },
        b: { url: "https://b" },
      },
    });
    const out = mergeMcpServersJson(existing, imported);
    expect(out).toMatchObject({ ok: true, added: 1, skipped: 1 });
    expect(JSON.parse(out.text!)).toEqual({
      mcpServers: {
        a: { command: "old-a" },
        keep: { command: "keep" },
        b: { url: "https://b" },
      },
    });
  });

  it("保留已有顶层非 mcpServers 键", () => {
    const existing = JSON.stringify({ $schema: "x", mcpServers: {} });
    const out = mergeMcpServersJson(existing, JSON.stringify({ a: { command: "a" } }));
    expect(JSON.parse(out.text!)).toEqual({
      $schema: "x",
      mcpServers: { a: { command: "a" } },
    });
  });

  it("已有内容不是合法 JSON → 报错且不返回新文本", () => {
    const out = mergeMcpServersJson("{ broken", JSON.stringify({ a: { command: "a" } }));
    expect(out.ok).toBe(false);
    expect(out.text).toBeUndefined();
  });

  it("导入内容不是合法 JSON → 报错", () => {
    const out = mergeMcpServersJson(null, "[1,2]");
    expect(out.ok).toBe(false);
    expect(out.text).toBeUndefined();
  });
});
