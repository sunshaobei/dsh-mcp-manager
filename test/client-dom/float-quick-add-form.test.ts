// @vitest-environment happy-dom
/**
 * dsh-mcp-manager — client-dom：float/quick-add.ts 的直接判据（保存三种落点 + 编辑器 + 页面构建）。
 *
 * 环境声明必须落在文件里（变异面按拓扑派生的是单 project node 环境配置）。
 *
 * 手填表单已整体移除（v0.4.0）：添加/编辑一律经「多源 mcp.json 编辑器」，保存走
 * performSaveRequest。本文件守的事实：
 * - isMigratedEdit / performSaveRequest：改名或改归属才走 POST+DELETE；原条目有凭据时
 *   **无条件中止**（M7 大声失败，不得半迁移）；scope 由 projectRoot 回落（无 DOM 依赖）。
 * - beginEdit / openJsonEditor：编辑态与 JSON 编辑器弹层；保存接线走 performSaveRequest。
 * - buildQuickAdd：页面只剩「多源 mcp.json 编辑器」section；JSON 导入成功/跳过/失败
 *   三态各自的结果文案。
 *
 * 假件说明（testing SKILL §3 例外清单）：
 * - fetch：globalThis 上的**手写**替身，只回放脚本给的响应并记录 (url, method, body)，
 *   不实现任何服务端语义；不用 vi.mock/vi.fn/vi.spyOn。
 * - actions：手写记录对象（满足 UiActions 全部成员），只记调用名。
 * - window.alert：手写记录函数，afterEach 还原。
 * - 无时钟依赖、不落盘、无真实 sleep。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { bindLocale } from "../../src/vendor/shared/client/i18n.js";
import { createState } from "../../src/client/core/state.ts";
import type { McpServerListEntry, McpState, UiActions } from "../../src/client/core/state.ts";
import {
  buildQuickAdd,
  beginEdit,
  currentCwdBody,
  formScopeValue,
  isEditing,
  isMigratedEdit,
  jsonWriteInit,
  performSaveRequest,
  resetForm,
} from "../../src/client/float/quick-add.ts";

/** 假译函数用到的模板：只列本文件断言真正读到文案的键。 */
const FAKE_ZH: Record<string, string> = {
  saveFail: "保存失败：{msg}",
  importFail: "导入失败：{msg}",
  importedOk: "已导入：{names}",
  importedNone: "（无）",
  importSkipped: "跳过（已存在）：{names}",
  editServer: "编辑服务器：{name}",
  addServer: "添加服务器",
};

const entry = (raw: Partial<McpServerListEntry> = {}): McpServerListEntry =>
  ({
    name: "ctx7",
    transport: "stdio",
    status: "connected",
    scope: "global",
    enabled: true,
    ...raw,
  }) as McpServerListEntry;

/** 手写 fetch 假件：记录 (url, method, body)，回放固定 JSON 响应。 */
class FetchFake {
  calls: Array<{ url: string; method: string; body: unknown }> = [];
  /** 下一次响应的 body；setFail 切成非 2xx。 */
  payload: unknown = {};
  private failNext = false;
  private readonly realFetch: typeof globalThis.fetch;

  constructor() {
    this.realFetch = globalThis.fetch;
    globalThis.fetch = ((input: unknown, init?: RequestInit) => {
      this.calls.push({ url: String(input), method: init?.method ?? "GET", body: init?.body });
      if (this.failNext) {
        this.failNext = false;
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async (): Promise<unknown> => ({ error: "boom" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async (): Promise<unknown> => this.payload,
      });
    }) as unknown as typeof globalThis.fetch;
  }

  failOnce(): void {
    this.failNext = true;
  }

  restore(): void {
    globalThis.fetch = this.realFetch;
  }
}

/** 手写 actions 记录器：满足 UiActions 全部成员，只记调用名。 */
function makeActions(): { actions: UiActions; calls: string[] } {
  const calls: string[] = [];
  const actions: UiActions = {
    refresh: async (): Promise<boolean> => {
      calls.push("refresh");
      return true;
    },
    resetForm: (): void => {
      calls.push("resetForm");
    },
    beginEdit: (): void => {
      calls.push("beginEdit");
    },
    switchTab: (tab: string): void => {
      calls.push("switchTab:" + tab);
    },
    close: (): void => {
      calls.push("close");
    },
    showPanel: (): void => {
      calls.push("showPanel");
    },
    toggleFloat: (): void => {
      calls.push("toggleFloat");
    },
  };
  return { actions, calls };
}

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

/**
 * buildQuickAdd 构建期即发起一次「多源 mcp.json 配置」GET（/api/dsh-mcp/sources?cwd=…，
 * 声明式多源功能），先于一切业务请求。业务断言一律经 businessCalls() 滤掉它；
 * 它自身的形态（次数 / URL / method / body）由「多源编辑器」describe 单独钉死——
 * 两条路都严格校验，谁也不放水。
 */
function isMountSourcesGet(c: { url: string; method: string }): boolean {
  return c.method === "GET" && c.url.startsWith("/api/dsh-mcp/sources");
}
function businessCalls(): Array<{ url: string; method: string; body: unknown }> {
  return fetchFake.calls.filter((c) => !isMountSourcesGet(c));
}
function mountGets(): Array<{ url: string; method: string; body: unknown }> {
  return fetchFake.calls.filter(isMountSourcesGet);
}

let fetchFake: FetchFake;
let alerts: string[];
const realAlert = window.alert;

/** 建一份 state 并把 buildQuickAdd 的页面挂到 document.body。 */
function builtState(raw: Partial<McpState> = {}): McpState {
  const state = createState();
  Object.assign(state, raw);
  const page = buildQuickAdd(state, makeActions().actions);
  document.body.appendChild(page);
  return state;
}

beforeEach(() => {
  document.body.textContent = "";
  alerts = [];
  fetchFake = new FetchFake();
  bindLocale(
    {
      bind:
        () =>
        (key: string, params?: Record<string, unknown>): string => {
          const template = FAKE_ZH[key];
          if (template === undefined) return key;
          let out = template;
          for (const [name, value] of Object.entries(params ?? {})) {
            out = out.split(`{${name}}`).join(String(value));
          }
          return out;
        },
    },
    "mcpManager",
  );
  window.alert = (msg?: string): void => {
    alerts.push(String(msg));
  };
});

afterEach(() => {
  fetchFake.restore();
  window.alert = realAlert;
  document.body.textContent = "";
  bindLocale({ bind: () => (key: string) => key }, "mcpManager");
});

describe("quick-add：基础判定", () => {
  it("currentCwdBody：非空 cwd 带键，空串与缺失不带键（读不到 ≠ 清空绑定）", () => {
    const s = builtState({ currentCwd: "/w" });
    expect(currentCwdBody(s)).toEqual({ cwd: "/w" });
    s.currentCwd = "";
    expect(currentCwdBody(s)).toEqual({});
    s.currentCwd = undefined;
    expect(currentCwdBody(s)).toEqual({});
  });

  it("formScopeValue：按 projectRoot 回落（有根 project、无根 global），不读 DOM", () => {
    expect(formScopeValue(builtState({ projectRoot: "/p" }))).toBe("project");
    expect(formScopeValue(builtState())).toBe("global");
  });

  it("isEditing：editingName 已设即为编辑态", () => {
    const s = builtState();
    expect(isEditing(s)).toBe(false);
    s.editingName = "a";
    expect(isEditing(s)).toBe(true);
  });
});

describe("quick-add：迁移判据", () => {
  it("isMigratedEdit：未在编辑态判假（新建不是迁移）", () => {
    expect(
      isMigratedEdit(builtState(), { name: "a", transport: "stdio" }, { scope: "global" }),
    ).toBe(false);
  });

  it("isMigratedEdit：同名同 scope 判假（PATCH 按 (scope,name) 定位得住）", () => {
    const s = builtState({ editingName: "a", editing: entry({ name: "a", scope: "global" }) });
    expect(isMigratedEdit(s, { name: "a", transport: "stdio" }, { scope: "global" })).toBe(false);
  });

  it("isMigratedEdit：改名判真（PATCH 会 404，必须走 POST+DELETE）", () => {
    const s = builtState({ editingName: "a", editing: entry({ name: "a", scope: "global" }) });
    expect(isMigratedEdit(s, { name: "b", transport: "stdio" }, { scope: "global" })).toBe(true);
  });

  it("isMigratedEdit：改归属判真", () => {
    const s = builtState({ editingName: "a", editing: entry({ name: "a", scope: "global" }) });
    expect(isMigratedEdit(s, { name: "a", transport: "stdio" }, { scope: "project" })).toBe(true);
  });

  it("isMigratedEdit：editing 缺 scope 时同名判假（无定位信息可据）", () => {
    const s = builtState({ editingName: "a" });
    expect(isMigratedEdit(s, { name: "a", transport: "stdio" }, { scope: "project" })).toBe(false);
  });
});

describe("quick-add：保存三种落点", () => {
  it("jsonWriteInit：POST + content-type + JSON body", () => {
    expect(jsonWriteInit({ a: 1 })).toEqual({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"a":1}',
    });
  });

  it("新建：单发 POST 到 servers 端点", async () => {
    const s = builtState();
    const ok = await performSaveRequest(s, { name: "a", transport: "stdio" }, { name: "a" });
    expect(ok).toBe(true);
    // 挂载期 GET /sources 之外，业务请求恰一条
    expect(mountGets()).toHaveLength(1);
    expect(businessCalls()).toEqual([
      { url: "/api/dsh-mcp/servers", method: "POST", body: '{"name":"a"}' },
    ]);
  });

  it("编辑（同名同 scope）：PATCH 按 (scope,name) 定位（scope 由 projectRoot 回落）", async () => {
    const s = builtState({ editingName: "a", editing: entry({ name: "a", scope: "global" }) });
    const ok = await performSaveRequest(
      s,
      { name: "a", transport: "stdio" },
      { name: "a", scope: "global" },
    );
    expect(ok).toBe(true);
    expect(mountGets()).toHaveLength(1);
    expect(businessCalls()).toEqual([
      {
        url: "/api/dsh-mcp/servers?name=a&scope=global",
        method: "PATCH",
        body: '{"name":"a","scope":"global"}',
      },
    ]);
  });

  it("编辑：名称与 scope 都被 URL 编码", async () => {
    const s = builtState({ editingName: "a b", editing: entry({ name: "a b", scope: "global" }) });
    await performSaveRequest(
      s,
      { name: "a b", transport: "stdio" },
      { name: "a b", scope: "global" },
    );
    expect(businessCalls()[0]!.url).toBe("/api/dsh-mcp/servers?name=a%20b&scope=global");
  });

  it("迁移（改名）：先 POST 新条目再 DELETE 旧条目，顺序不可颠倒", async () => {
    const s = builtState({ editingName: "a", editing: entry({ name: "a", scope: "global" }) });
    const ok = await performSaveRequest(
      s,
      { name: "b", transport: "stdio" },
      { name: "b", scope: "global" },
    );
    expect(ok).toBe(true);
    expect(businessCalls().map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/dsh-mcp/servers",
      "DELETE /api/dsh-mcp/servers?name=a&scope=global",
    ]);
  });

  it("迁移且原条目有凭据：**无条件中止**，零请求且大声失败（M7）", async () => {
    const s = builtState({
      editingName: "a",
      editing: entry({ name: "a", scope: "global", hasSecrets: true }),
    });
    const ok = await performSaveRequest(
      s,
      { name: "b", transport: "stdio" },
      { name: "b", scope: "global" },
    );
    expect(ok).toBe(false);
    expect(businessCalls()).toHaveLength(0);
    expect(alerts).toHaveLength(1);
    // 文案须指引手动路径，不得承诺「重填后保存」——该后续路径在无条件拦截下不存在。
    expect(alerts[0]).toContain("新建同名条目");
  });

  it("迁移且原条目无凭据：放行", async () => {
    const s = builtState({
      editingName: "a",
      editing: entry({ name: "a", scope: "global", hasSecrets: false }),
    });
    const ok = await performSaveRequest(
      s,
      { name: "b", transport: "stdio" },
      { name: "b", scope: "global" },
    );
    expect(ok).toBe(true);
    expect(businessCalls()).toHaveLength(2);
  });

  it("迁移时 DELETE 用**原归属**而非新归属（旧条目就位在原 scope 上）", async () => {
    const s = builtState({
      editingName: "a",
      editing: entry({ name: "a", scope: "project" }),
    });
    await performSaveRequest(s, { name: "a", transport: "stdio" }, { name: "a", scope: "global" });
    expect(businessCalls()[1]!.url).toBe("/api/dsh-mcp/servers?name=a&scope=project");
  });
});

describe("quick-add：resetForm 与 beginEdit", () => {
  it("resetForm：只清编辑态（手填表单已移除，无 DOM 可重置）", () => {
    const s = builtState({ editingName: "a", editing: entry() });
    resetForm(s);
    expect(s.editingName).toBeUndefined();
    expect(s.editing).toBeUndefined();
  });

  it("resetForm：未设编辑态时也不抛", () => {
    const s = createState();
    expect(() => {
      resetForm(s);
    }).not.toThrow();
    expect(s.editingName).toBeUndefined();
  });

  it("beginEdit：设编辑态并弹出大号 JSON 编辑器（不再回填行内表单/切 tab）", () => {
    const s = builtState();
    const { actions, calls } = makeActions();
    beginEdit(s, actions, entry({ name: "ctx7", scope: "project", command: "npx" }));
    expect(s.editingName).toBe("ctx7");
    expect(s.editing?.name).toBe("ctx7");
    // 行内表单回填与 switchTab 已弃用：改为弹出整卡 JSON 编辑器
    expect(calls).toEqual([]);
    const overlay = document.querySelector<HTMLElement>(".dm-overlay")!;
    expect(overlay.querySelector("h2")?.textContent).toBe("编辑服务器：ctx7");
    const area = overlay.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(JSON.parse(area.value)).toMatchObject({ name: "ctx7", command: "npx" });
    // 取消按钮：关闭弹层（编辑态由后续动作处理）
    const cancelBtn = [...overlay.querySelectorAll("button")].find(
      (b) => b.textContent === "cancel",
    )!;
    cancelBtn.dispatchEvent(new Event("click"));
    expect(document.querySelector(".dm-overlay")).toBeNull();
  });

  it("beginEdit：标题改成「编辑服务器：<name>」", () => {
    const s = builtState();
    beginEdit(s, makeActions().actions, entry({ name: "ctx7" }));
    // 译后文案且 {name} 已插值——只断 key 形态的话，插值写错也看不出来。
    expect(document.querySelector(".dm-overlay h2")?.textContent).toBe("编辑服务器：ctx7");
  });

  it("beginEdit 之后 performSaveRequest 走 PATCH 而非 POST（编辑态就位）", async () => {
    const s = builtState();
    beginEdit(s, makeActions().actions, entry({ name: "ctx7", scope: "global" }));
    document.querySelector(".dm-overlay")!.remove(); // 关掉编辑器弹层，只留编辑态断言面
    const ok = await performSaveRequest(
      s,
      { name: "ctx7", transport: "stdio" },
      { name: "ctx7", scope: "global" },
    );
    expect(ok).toBe(true);
    expect(businessCalls()[0]!.method).toBe("PATCH");
    expect(businessCalls()[0]!.url).toBe("/api/dsh-mcp/servers?name=ctx7&scope=global");
  });
});

describe("quick-add：buildQuickAdd 页面构建", () => {
  it("手填表单已移除：页面只有「多源 mcp.json 编辑器」section", () => {
    builtState();
    expect(document.getElementById("dm-form-title")).toBeNull();
    expect(document.querySelector("[data-dm-cancel]")).toBeNull();
    expect(document.querySelector("section h3")?.textContent).toBe("sourcesTitle");
  });

  it("点编辑器「保存」按钮真的走 performSaveRequest（PATCH 通道接线不是装饰）", async () => {
    // 手填表单已退出快速接入页，保存入口是大号 JSON 编辑器：改接线（保存按钮
    // onclick 指错函数 / 摘掉 onclick）本条必须红。
    const state = builtState();
    const { actions, calls } = makeActions();
    beginEdit(state, actions, entry({ name: "ctx7", scope: "global" }));
    const overlay = document.querySelector<HTMLElement>(".dm-overlay")!;
    const area = overlay.querySelector<HTMLTextAreaElement>("textarea")!;
    area.value = JSON.stringify({
      name: "ctx7",
      transport: "stdio",
      scope: "global",
      command: "bun",
    });
    const saveBtn = overlay.querySelector<HTMLButtonElement>(".dm-actions button")!;
    saveBtn.dispatchEvent(new Event("click"));
    await settle();
    const sent = businessCalls();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("/api/dsh-mcp/servers?name=ctx7&scope=global");
    expect(sent[0]!.method).toBe("PATCH");
    expect(JSON.parse(String(sent[0]!.body))).toMatchObject({ name: "ctx7", command: "bun" });
    expect(calls).toEqual(["refresh"]);
  });

  it("点编辑器「取消」按钮真的关闭弹层（配置不动、零请求）", () => {
    const state = builtState();
    beginEdit(state, makeActions().actions, entry({ name: "ctx7" }));
    expect(document.querySelector(".dm-overlay")).not.toBeNull();
    const overlay = document.querySelector<HTMLElement>(".dm-overlay")!;
    const cancelBtn = [...overlay.querySelectorAll("button")].find(
      (b) => b.textContent === "cancel",
    )!;
    cancelBtn.dispatchEvent(new Event("click"));
    expect(document.querySelector(".dm-overlay")).toBeNull();
    expect(businessCalls()).toHaveLength(0);
  });

  it("页面含多源 mcp.json 编辑器区与结果容器（手填表单/粘贴导入均不再挂载）", async () => {
    fetchFake.payload = {
      sources: [
        { id: "global-dsh", path: "/g/.dsh/mcp.json", exists: true, error: null, text: "{}" },
        { id: "project-agents", path: null, exists: false, error: null, text: null },
      ],
      prefs: {},
    };
    builtState();
    await settle();
    expect(document.querySelector(".dm-result")).not.toBeNull();
    expect(document.querySelector(".dm-paste-box textarea")).toBeNull();
    expect(document.getElementById("dm-form-title")).toBeNull();
    const cards = [...document.querySelectorAll<HTMLElement>("[data-dm-src]")];
    expect(cards.map((c) => c.dataset.dmSrc)).toEqual(["global-dsh", "project-agents"]);
  });
});

describe("quick-add：多源 mcp.json 编辑器（声明式来源）", () => {
  /** 建页面（真实挂到 body）并注入 loadSources 的响应载荷。 */
  function sourceSetup(
    payload: unknown,
    raw: Partial<McpState> = {},
  ): {
    state: McpState;
    page: HTMLElement;
    calls: string[];
    actions: UiActions;
  } {
    const { actions, calls } = makeActions();
    const state = createState();
    Object.assign(state, raw);
    const page = buildQuickAdd(state, actions);
    document.body.appendChild(page);
    fetchFake.payload = payload;
    return { state, page, calls, actions };
  }

  it("构建即拉取来源：GET /api/dsh-mcp/sources?cwd=…，cwd 经 URL 编码（挂载期唯一一笔）", async () => {
    sourceSetup({ sources: [], prefs: {} }, { currentCwd: "/w" });
    await settle();
    expect(mountGets()).toHaveLength(1);
    expect(fetchFake.calls[0]).toEqual({
      url: "/api/dsh-mcp/sources?cwd=%2Fw",
      method: "GET",
      body: undefined,
    });
  });

  it("cwd 为空时不带编码值（?cwd= 空串形态）", async () => {
    sourceSetup({ sources: [], prefs: {} });
    await settle();
    expect(mountGets()[0]!.url).toBe("/api/dsh-mcp/sources?cwd=");
  });

  it("来源渲染成卡片：data-dm-src 标识、路径与缺失态可见", async () => {
    const { page } = sourceSetup({
      sources: [
        { id: "global-dsh", path: "/g/.dsh/mcp.json", exists: true, error: null, text: "{}" },
        { id: "project-agents", path: null, exists: false, error: null, text: null },
      ],
      prefs: {},
    });
    await settle();
    const cards = [...page.querySelectorAll<HTMLElement>("[data-dm-src]")];
    expect(cards.map((c) => c.dataset.dmSrc)).toEqual(["global-dsh", "project-agents"]);
    expect(cards[0]!.textContent).toContain("/g/.dsh/mcp.json");
    expect(cards[0]!.textContent).not.toContain("srcNotExists");
    // path 为 null → 提示需要会话；不存在 → 追加「文件不存在」标记
    expect(cards[1]!.textContent).toContain("srcNeedSession");
    expect(cards[1]!.textContent).toContain("srcNotExists");
  });

  it("拉取成功后清空结果提示；失败则写「导入失败：…」（不抛）", async () => {
    const ok = sourceSetup({ sources: [], prefs: {} });
    await settle();
    expect(ok.page.querySelector(".dm-result")?.textContent).toBe("");
    fetchFake.failOnce();
    document.body.appendChild(buildQuickAdd(ok.state, ok.actions));
    await settle();
    const hints = [...document.querySelectorAll(".dm-result")];
    expect(hints.some((h) => (h.textContent ?? "").includes("boom"))).toBe(true);
  });

  it("来源「编辑」→ 弹层大编辑器；保存 POST sources/save（带 id/text/cwd）并 refresh", async () => {
    const { page, calls } = sourceSetup(
      {
        sources: [
          { id: "global-dsh", path: "/g/mcp.json", exists: true, error: null, text: '{"a":1}' },
        ],
        prefs: {},
      },
      { currentCwd: "/w" },
    );
    await settle();
    page
      .querySelector<HTMLButtonElement>("[data-dm-src='global-dsh'] .dm-actions button")!
      .dispatchEvent(new Event("click"));
    const overlay = document.querySelector<HTMLElement>(".dm-overlay")!;
    expect(overlay.querySelector("h2")?.textContent).toBe("srcGlobalDsh");
    const area = overlay.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(area.value).toBe('{"a":1}');
    area.value = '{"a":2}';
    fetchFake.payload = { effective: [{ name: "a" }], removed: [{ name: "b" }], warnings: ["w1"] };
    overlay.querySelector<HTMLButtonElement>(".dm-actions button")!.dispatchEvent(new Event("click"));
    await settle();
    expect(businessCalls()).toEqual([
      {
        url: "/api/dsh-mcp/sources/save?cwd=%2Fw",
        method: "POST",
        body: JSON.stringify({ id: "global-dsh", text: '{"a":2}', cwd: "/w" }),
      },
    ]);
    expect(calls).toEqual(["refresh"]);
  });
});
