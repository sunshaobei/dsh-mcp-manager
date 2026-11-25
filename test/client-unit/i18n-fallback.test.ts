/**
 * dsh-mcp-manager — locale 兜底门禁。
 *
 * 2026-11 桌面端升级 0.2.2 后实测：HMR/二次装载时 `locale.register(ns, …)` 可能
 * 因命名空间已存在而抛错，旧实现把 `bindLocale` 放在同一个 try 里，register 一抛
 * 就再也不会绑定；界面直接显示 `panelTitle` / `tabServers` 这类内部 key。
 *
 * 这里锁两件事：
 *   1. register 抛错也必须继续 bind；
 *   2. 宿主 bind 在命名空间缺失时原样返回 key，此时用自带 zh 字典兜底。
 */
import { afterEach, describe, expect, it } from "vitest";

import { bindLocale, setFallbackDict, t } from "../../src/vendor/shared/client/i18n.js";

afterEach(() => {
  setFallbackDict({});
  bindLocale(undefined, "mcpManager");
});

describe("locale 兜底", () => {
  it("宿主 bind 原样返回 key 时，用自带字典兜底而不是暴露内部 key", () => {
    setFallbackDict({ panelTitle: "MCP 管理器", tabServers: "服务器" });
    bindLocale({ bind: () => (key: string) => key }, "mcpManager");
    expect(t("panelTitle")).toBe("MCP 管理器");
    expect(t("tabServers")).toBe("服务器");
  });

  it("宿主没有 locale 服务时也使用自带字典", () => {
    setFallbackDict({ refresh: "刷新" });
    bindLocale(undefined, "mcpManager");
    expect(t("refresh")).toBe("刷新");
  });

  it("宿主有译文时优先宿主（不被兜底覆盖）", () => {
    setFallbackDict({ close: "关闭" });
    bindLocale({ bind: () => (key: string) => (key === "close" ? "Close" : key) }, "mcpManager");
    expect(t("close")).toBe("Close");
  });
});
