/**
 * dsh-mcp-manager — 客户端「服务器列表页」渲染。
 *
 * 按状态分级展示服务器卡片（端点 / 错误 / 工具列表 / 操作按钮）。
 * 跨模块动作（refresh / resetForm / beginEdit）经 actions 注入，不直接引用
 * panel/quick-add 模块，避免循环依赖。
 */

import { el, pangu } from "../core/dom.ts";
import { api, toolDisableServerKey, cwdQueryOf } from "../core/api.ts";
import { STATUS_ORDER } from "../core/constants.ts";
import { tStatus } from "../core/i18n.ts";
import { t } from "../../vendor/shared/client/i18n.js";
import type { McpServerListEntry, McpState, UiActions } from "../core/state.ts";

/** 服务器端点摘要：streamable-http 显示 URL，stdio 显示 command + args。 */
export function endpointOf(server: McpServerListEntry): string {
  if (server.transport === "streamable-http") return server.url ?? "";
  const args =
    Array.isArray(server.args) && server.args.length > 0 ? ` ${server.args.join(" ")}` : "";
  return `${server.command ?? ""}${args}`;
}

/** 操作按钮（统一失败提示）。 */
export function actionButton(
  label: string,
  onClick: () => void | Promise<void>,
  primary = false,
  danger = false,
): HTMLElement {
  const button = el("button", {
    class: `${primary ? "dm-primary" : ""} ${danger ? "dm-danger" : ""}`.trim(),
    text: label,
  });
  button.addEventListener("click", async () => {
    // 点击反馈：请求期间禁用并显示 loading，完成/失败后恢复。
    const original = label;
    button.disabled = true;
    button.style.opacity = "0.6";
    button.textContent = `${original}…`;
    try {
      await onClick();
    } catch (error) {
      window.alert(
        t("actionFail", { msg: error instanceof Error ? error.message : String(error) }),
      );
    } finally {
      button.disabled = false;
      button.style.opacity = "";
      button.textContent = original;
    }
  });
  return button;
}

/** 工具级禁用 checkbox（PATCH /api/dsh-mcp/tool-disable；#362 交互拍板 2b）。 */
function toolCheckbox(
  server: McpServerListEntry,
  tool: string,
  disabled: boolean,
  state: McpState,
  actions: UiActions,
): HTMLElement {
  const label = el("label", { class: "dm-tool" });
  const input = el("input", { type: "checkbox", checked: disabled });
  input.addEventListener("change", () => {
    // C6：全名形态经 toolDisableServerKey 归一，projectRoot 缺失时跳过提交
    // （防御非法 @/name，与浮窗 toolCheckbox 同口径）。
    const serverKey = toolDisableServerKey(server, state);
    if (serverKey === undefined) {
      input.checked = !input.checked;
      console.warn("[dsh-mcp-manager] projectRoot 缺失，跳过 tool-disable（非法 @/name 防御）");
      return;
    }
    void api<unknown>(state.API.toolDisable, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        server: serverKey,
        tool,
        disabled: input.checked,
      }),
    })
      .then(() => actions.refresh())
      .catch((error: unknown) => {
        input.checked = !input.checked;
        console.warn("[dsh-mcp-manager] tool-disable failed:", error);
      });
  });
  label.appendChild(input);
  label.appendChild(document.createTextNode(tool));
  return label;
}

/** 工具折叠组：interactive 出 checkbox（可逐个禁用），否则出纯文本工具名。 */
export function serverToolsDetails(
  server: McpServerListEntry,
  toolCount: number,
  opts: { tools: boolean; openTools?: Set<string> },
  state: McpState,
  actions: UiActions,
  interactive: boolean,
): HTMLElement {
  const details = el("details", { class: "dm-tools", dataset: { dmServer: server.name } });
  if (opts.openTools?.has(server.name) === true) details.open = true;
  details.appendChild(el("summary", { text: t("toolsCount", { n: toolCount }) }));
  const list = el("ul");
  const tools = Array.isArray(server.tools) ? server.tools : [];
  if (interactive) {
    const disabledSet = new Set(Array.isArray(server.disabledTools) ? server.disabledTools : []);
    for (const tool of tools) {
      list.appendChild(
        el("li", {}, [toolCheckbox(server, tool, disabledSet.has(tool), state, actions)]),
      );
    }
  } else {
    for (const tool of tools) list.appendChild(el("li", { text: tool }));
  }
  details.appendChild(list);
  return details;
}

/** 一个操作按钮的规格（label / 主按钮样式 / 执行体）。 */
interface ActionSpec {
  label: string;
  primary: boolean;
  danger?: boolean;
  run: () => void | Promise<void>;
}

/** JSON 写请求 init（PATCH enabled 用；形态与 quick-add 同款）。 */
export function jsonPatchInit(enabled: boolean): {
  method: "PATCH";
  headers: Record<string, string>;
  body: string;
} {
  return {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ enabled }),
  };
}

/** POST 后刷新（连接/断开/重连三个动作的执行体同式）。 */
export function postThenRefresh(
  state: McpState,
  actions: UiActions,
  url: string,
): () => Promise<void> {
  return async () => {
    await api<unknown>(url, { method: "POST" });
    await actions.refresh();
  };
}

/** 状态动作：connected → 断开 + 重连；disabled → 启用并连接；其余 → 连接。 */
/** 「启用此来源」执行体：POST sources/activate（改选 + 互斥同步 + 连接）。 */
function activateSourceRun(
  server: McpServerListEntry,
  state: McpState,
  actions: UiActions,
): () => Promise<void> {
  return async () => {
    const q = cwdQueryOf(state).replace(/^&/, "");
    await api<unknown>(`${state.API.sourceActivate}${q ? "?" + q : ""}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: server.name, id: server.source }),
    });
    await actions.refresh();
  };
};

export function statusActions(
  server: McpServerListEntry,
  state: McpState,
  actions: UiActions,
  scopeQuery: string,
  cwdQuery: string,
): ActionSpec[] {
  const name = encodeURIComponent(server.name);
  // 互斥落选条目（shadowedBy）：「连接」即「启用此来源」——先走 activate 改选
  // （同步会把其余同名的运行面副本移除断开），再刷新；直接 connect 会因该名
  // 不在对应 scope store 而报 not found（互斥生效表里只有胜者）。
  if ((server as { shadowedBy?: string }).shadowedBy !== undefined) {
    return [
      {
        label: t("connect"),
        primary: true,
        run: activateSourceRun(server, state, actions),
      },
    ];
  }
  if (server.status === "connected") {
    return [
      {
        label: t("disconnect"),
        primary: false,
        run: postThenRefresh(
          state,
          actions,
          `${state.API.disconnect}?name=${name}${scopeQuery}${cwdQuery}`,
        ),
      },
      {
        label: t("reconnect"),
        primary: false,
        run: postThenRefresh(
          state,
          actions,
          `${state.API.reconnect}?name=${name}${scopeQuery}${cwdQuery}`,
        ),
      },
    ];
  }
  if (server.status === "disabled") {
    return [
      {
        label: t("enableAndConnect"),
        primary: true,
        run: async () => {
          await api<unknown>(`${state.API.servers}?name=${name}${scopeQuery}`, jsonPatchInit(true));
          await api<unknown>(`${state.API.connect}?name=${name}${scopeQuery}${cwdQuery}`, {
            method: "POST",
          });
          await actions.refresh();
        },
      },
    ];
  }
  return [
    {
      label: t("connect"),
      primary: true,
      run: postThenRefresh(
        state,
        actions,
        `${state.API.connect}?name=${name}${scopeQuery}${cwdQuery}`,
      ),
    },
  ];
}

/** 禁用动作（非 disabled 行才有）：PATCH 后若正在编辑该条目则重置表单。 */
export function disableAction(
  server: McpServerListEntry,
  state: McpState,
  actions: UiActions,
  scopeQuery: string,
  cwdQuery: string,
): ActionSpec {
  const name = encodeURIComponent(server.name);
  return {
    label: t("disable"),
    primary: false,
    run: async () => {
      // C7：disable 带 cwd（与 disconnect 对齐，#412 会话自愈）。
      await api<unknown>(
        `${state.API.servers}?name=${name}${scopeQuery}${cwdQuery}`,
        jsonPatchInit(false),
      );
      if (state.editingName === server.name) actions.resetForm();
      await actions.refresh();
    },
  };
}

/** 删除动作：先确认（未确认即中止），DELETE 后若正在编辑该条目则重置表单。 */
export function deleteAction(
  server: McpServerListEntry,
  state: McpState,
  actions: UiActions,
  scopeQuery: string,
): ActionSpec {
  const name = encodeURIComponent(server.name);
  return {
    label: t("delete"),
    primary: false,
    danger: true,
    run: async () => {
      if (!window.confirm(t("confirmDelete", { name: server.name }))) return;
      await api<unknown>(`${state.API.servers}?name=${name}${scopeQuery}`, { method: "DELETE" });
      if (state.editingName === server.name) actions.resetForm();
      await actions.refresh();
    },
  };
}

/** 需要置顶提醒的服务器（失败 + 重连中）。 */
export function needsAttention(server: McpServerListEntry): boolean {
  return server.status === "failed" || server.status === "reconnecting";
}

/** 按状态分桶（桶序 = STATUS_ORDER；未知状态归 stopped 桶，不丢行）。 */
export function bucketByStatus(list: McpServerListEntry[]): Map<string, McpServerListEntry[]> {
  const byStatus = new Map<string, McpServerListEntry[]>();
  for (const group of STATUS_ORDER) byStatus.set(group.key, []);
  for (const server of list) {
    const bucket = byStatus.get(server.status) ?? byStatus.get("stopped");
    if (bucket !== undefined) bucket.push(server);
  }
  return byStatus;
}
/** 卡片根类名：失败 / 重连中加 --fail 修饰。 */
export function serverCardClass(server: McpServerListEntry): string {
  return needsAttention(server) ? "dm-server dm-server--fail" : "dm-server";
}

/** 卡片头部：名称 / transport 徽标 / scope 徽标 / 状态徽标 / 工具计数。 */
export function serverCardHeader(server: McpServerListEntry, toolCount: number): HTMLElement {
  const isHttp = server.transport === "streamable-http";
  const header = el("header");
  header.appendChild(el("span", { class: "dm-name", text: server.name }));
  header.appendChild(
    el("span", {
      class: `dm-badge ${isHttp ? "dm-http" : "dm-stdio"}`,
      text: isHttp ? "HTTP" : "stdio",
    }),
  );
  header.appendChild(
    el("span", {
      class: "dm-badge",
      text: server.scope === "project" ? t("badgeScopeProject") : t("badgeScopeGlobal"),
    }),
  );
  header.appendChild(
    el("span", { class: `dm-badge dm-st-${server.status}`, text: tStatus(server.status) }),
  );
  header.appendChild(
    el("span", { class: "dm-count", text: t("toolsCountPlain", { n: toolCount }) }),
  );
  return header;
}

/** 渲染单台服务器卡片。 */
export function renderServer(
  server: McpServerListEntry,
  state: McpState,
  actions: UiActions,
  opts: { tools: boolean; openTools?: Set<string> } = { tools: true },
): HTMLElement {
  const article = el("article", { class: serverCardClass(server) });
  const toolCount = Array.isArray(server.tools) ? server.tools.length : 0;
  article.appendChild(serverCardHeader(server, toolCount));

  article.appendChild(el("div", { class: "dm-endpoint", text: endpointOf(server) }));
  if (server.error !== undefined && server.error !== "") {
    article.appendChild(el("div", { class: "dm-err", text: server.error }));
  }

  if (toolCount > 0) {
    article.appendChild(serverToolsDetails(server, toolCount, opts, state, actions, opts.tools));
  }

  const actionsEl = el("div", { class: "dm-actions" });
  const busy = server.status === "connecting" || server.status === "reconnecting";
  const scopeQuery = `&scope=${server.scope}`;
  // #412 复报：带 cwd 供路由 maybeSession 会话自愈。
  const cwdQuery = cwdQueryOf(state);
  // 开关化（用户契约）：工作区配置只保留「启用/停用」一个开关，不做连通性要求；
  // 连通性是启动期后台扫描的读数，失败只在状态徽章 + 卡片错误行呈现。
  actionsEl.appendChild(enabledSwitch(server, state, actions, cwdQuery));
  if ((server as { shadowedBy?: string }).shadowedBy === undefined) {
    actionsEl.appendChild(actionButton(t("edit"), () => actions.beginEdit(server)));
    const remove = deleteAction(server, state, actions, scopeQuery);
    actionsEl.appendChild(
      actionButton(remove.label, remove.run, remove.primary, remove.danger === true),
    );
    (actionsEl.children[actionsEl.children.length - 1] as HTMLButtonElement).disabled = busy;
  }
  article.appendChild(actionsEl);
  return article;
}

/**
 * 启用开关（弹窗与浮层共用）：开 = enabled:true（连接由后台 reconcile 自行走），
 * 关 = enabled:false（拆连接）。互斥落选条目开 = activate 改选该来源。
 * 连通性失败不阻断开关——开关只表达「要不要用」，连通性由徽章/错误行读数呈现。
 */
export function enabledSwitch(
  server: McpServerListEntry,
  state: McpState,
  actions: UiActions,
  cwdQuery: string,
): HTMLElement {
  const shadowed = (server as { shadowedBy?: string }).shadowedBy !== undefined;
  const checked = shadowed ? false : server.enabled !== false;
  const wrap = el("label", {
    class: "dm-switch",
    role: "switch",
    "aria-checked": String(checked),
    title: shadowed ? t("srcActivateThis") : checked ? t("disable") : t("enable"),
  });
  const box = document.createElement("input");
  box.type = "checkbox";
  box.checked = checked;
  const slider = el("span", { class: "dm-switch-slider" });
  wrap.appendChild(box);
  wrap.appendChild(slider);
  const name = encodeURIComponent(server.name);
  box.addEventListener("change", () => {
    wrap.setAttribute("aria-checked", String(box.checked));
    wrap.classList.add("dm-switch--busy");
    const run = shadowed && box.checked
      ? activateSourceRun(server, state, actions)
      : async () => {
          await api<unknown>(
            `${state.API.servers}?name=${name}&scope=${server.scope}${cwdQuery}`,
            { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: box.checked }) },
          );
          await actions.refresh();
        };
    run()
      .catch((error: unknown) => {
        // 失败回弹开关并提示
        box.checked = checked;
        window.alert(
          t("actionFail", { msg: error instanceof Error ? error.message : String(error) }),
        );
      })
      .finally(() => wrap.classList.remove("dm-switch--busy"));
  });
  return wrap;
}

/** 分组折叠态记忆（sourceId → 是否展开）：跨 refresh 重建保持用户折叠选择。 */
const groupFoldOpen = new Map<string, boolean>();

/** 渲染服务器列表页（#362 交互拍板 1a：项目级 / 全局级两大分组，各自内部再按状态）。
 * 单池（#767）后两大分组的服务器都经中间层，工具 checkbox 一律可用。 */
export function renderServers(state: McpState, actions: UiActions): void {
  if (state.bodyEl === undefined) return;
  // C8：checkbox 操作后 actions.refresh 全量重建会丢 <details> 折叠态——渲染
  // 前收集当前展开的工具组（按 server 名），重建后恢复（连续禁用 N 个工具
  // 免反复展开）。
  const openTools = new Set<string>();
  for (const d of state.bodyEl.querySelectorAll<HTMLDetailsElement>("details.dm-tools")) {
    if (d.open && d.dataset.dmServer !== undefined) openTools.add(d.dataset.dmServer);
  }
  state.bodyEl.textContent = "";
  if (state.servers.length === 0) {
    state.bodyEl.appendChild(
      el("div", { class: "dm-status", children: [document.createTextNode(t("serversEmpty"))] }),
    );
    return;
  }
  // 分组契约：按四个声明来源分组（全局.dsh / 全局.agents / 项目.dsh / 项目.agents），
  // 无来源标记的历史条目归入「其他」。失败不再单独置顶（状态徽章在卡片上可见）。
  // 展示顺序：全局在前、项目在后（与快速接入页编辑器顺序一致）。
  const SOURCE_GROUPS: readonly { id: string; labelKey: string }[] = [
    { id: "global-dsh", labelKey: "srcGlobalDsh" },
    { id: "global-agents", labelKey: "srcGlobalAgents" },
    { id: "project-dsh", labelKey: "srcProjectDsh" },
    { id: "project-agents", labelKey: "srcProjectAgents" },
  ];
  const rest = state.servers;
  // 固定四分组：卡片直接归组（不再按运行状态二次分桶），组标题可点击折叠（默认折叠）。
  // 分组折叠态跨刷新持久（用户契约）：动作触发 refresh 全量重建，折叠态若不记忆
  // 会被打回默认折叠，操作连续多台时极难用。模块级表按 sourceId 记忆，渲染时恢复。
  const appendGroup = (sourceId: string, label: string, list: McpServerListEntry[]): void => {
    const connCount = list.filter((s) => s.status === "connected").length;
    const failCount = list.filter((s) => s.status === "failed" || s.status === "reconnecting").length;
    const title = `${label} (${list.length}) · 运行 ${connCount} · 失败 ${failCount}`;
    const section = el("section", {
      class: "dm-group",
      style:
        "border:1px solid var(--dsw-alias-border-l2, #e2e4ea);border-radius:14px;padding:10px 14px;margin:0 0 14px;",
    });
    const titleEl = el("h3", {
      style: "cursor:pointer;user-select:none;margin:0 0 10px;",
    });
    const wrap = el("div", {
      style: `display:${groupFoldOpen.get(sourceId) ? "" : "none"};`, // 默认折叠；折叠态跨刷新记忆
    });
    const setArrow = (): void => {
      titleEl.replaceChildren(
        document.createTextNode(`${wrap.style.display === "none" ? "▸" : "▾"} ${title}　`),
      );
    };
    titleEl.addEventListener("click", () => {
      wrap.style.display = wrap.style.display === "none" ? "" : "none";
      groupFoldOpen.set(sourceId, wrap.style.display !== "none");
      setArrow();
    });
    setArrow();
    const headRow = el("div", { style: "display:flex;align-items:center;gap:12px;" });
    headRow.appendChild(titleEl);
    const quickLink = el("span", {
      text: "＋ " + t("srcQuickSetup"),
      style:
        "cursor:pointer;font-size:12px;color:var(--dsw-alias-state-business-primary, #2f6fe0);user-select:none;",
    });
    quickLink.addEventListener("click", () => {
      actions.switchTab("quick");
      requestAnimationFrame(() => {
        state.bodyEl?.ownerDocument
          ?.querySelector(`[data-dm-src="${sourceId}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    headRow.appendChild(quickLink);
    section.appendChild(headRow);
    section.appendChild(wrap);
    for (const server of [...list].sort((a: McpServerListEntry, b: McpServerListEntry) =>
      a.name.localeCompare(b.name),
    )) {
      const card = renderServer(server, state, actions, { tools: true, openTools });
      card.style.marginLeft = "18px"; // 分组缩进
      wrap.appendChild(card);
    }
    state.bodyEl!.appendChild(section);
  };
  // 四组恒显示——空组只保留分组标题，不再渲染占位行。
  for (const group of SOURCE_GROUPS) {
    const list = rest.filter((server: McpServerListEntry) => server.source === group.id);
    appendGroup(group.id, `${t(group.labelKey)}`, list);
  }
  const ungrouped = rest.filter(
    (server: McpServerListEntry) => !SOURCE_GROUPS.some((g) => g.id === server.source),
  );
  if (ungrouped.length > 0) {
    appendGroup("other", `${t("srcUngrouped")}`, ungrouped);
  }
}
