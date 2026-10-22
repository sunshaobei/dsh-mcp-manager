// 同名互斥生效表（resolveEffective）契约测试：
// activate 记忆是**逐名**的——点哪个名字只切换哪个名字的生效来源，
// 其余名字仍按默认优先级裁决（用户契约：点 gitlabmcp 只关其它来源的同名 gitlabmcp）。
import { describe, expect, it } from "vitest";
import { resolveEffective, type ParsedSource, type SourceId } from "../../src/server/config/sources.ts";
import type { ServerConfig } from "../../src/shared/dto.ts";

function src(id: SourceId, names: readonly string[]): ParsedSource {
  return {
    id,
    path: `/${id}/mcp.json`,
    exists: true,
    servers: names.map(
      (name): ServerConfig => ({ name, transport: "stdio", command: "echo", scope: "global" }),
    ),
  };
}

const parsed: ParsedSource[] = [
  src("global-dsh", ["gitlabmcp", "shared"]),
  src("global-agents", ["gitlabmcp", "yapimcp"]),
  src("project-dsh", ["gitlabmcp"]),
  src("project-agents", ["gitlabmcp", "yapimcp", "sensorsmcp"]),
];

describe("resolveEffective 同名互斥（逐名 activate）", () => {
  it("默认优先级：项目 .agents 胜出", () => {
    const eff = resolveEffective(parsed);
    expect(eff.get("gitlabmcp")?.source).toBe("project-agents");
    expect(eff.get("yapimcp")?.source).toBe("project-agents");
  });

  it("activate 只覆盖被点名的那一个名字，其余名字不受影响", () => {
    const eff = resolveEffective(parsed, new Map([["gitlabmcp", "global-agents"]]));
    // 被点名的 gitlabmcp 切到全局 .agents
    expect(eff.get("gitlabmcp")?.source).toBe("global-agents");
    expect(eff.get("gitlabmcp")?.shadowed).toEqual([
      "global-dsh",
      "project-dsh",
      "project-agents",
    ]);
    // yapimcp / sensorsmcp / shared 仍按默认优先级，来源不变
    expect(eff.get("yapimcp")?.source).toBe("project-agents");
    expect(eff.get("sensorsmcp")?.source).toBe("project-agents");
    expect(eff.get("shared")?.source).toBe("global-dsh");
  });

  it("activate 指向未声明该名的来源时被忽略（回退优先级）", () => {
    const eff = resolveEffective(parsed, new Map([["yapimcp", "project-dsh"]]));
    expect(eff.get("yapimcp")?.source).toBe("project-agents");
  });
});
