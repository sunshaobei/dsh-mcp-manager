/**
 * dsh-mcp-manager — 客户端「快速接入」页：多源 mcp.json 编辑器与保存执行面。
 *
 * 手填表单已整体移除（v0.4.0）：添加/编辑一律经「多源 mcp.json 编辑器」
 * （beginEdit 打开 openJsonEditor，保存走 performSaveRequest）。跨模块动作
 * （refresh / switchTab）经 actions 注入，不直接引用 panel 模块，避免循环依赖。
 */

import { el } from "../core/dom.ts";
import { api, cwdQueryOf } from "../core/api.ts";
import { t } from "../../vendor/shared/client/i18n.js";
import type { McpState, UiActions } from "../core/state.ts";
import type { McpManagerServerInput, McpServerListEntry } from "../../shared/interface.ts";

/** 当前保存归属（project/global）：按 projectRoot 回落，无 DOM 依赖。 */
export function formScopeValue(state: McpState): string {
  return state.projectRoot !== undefined && state.projectRoot !== "" ? "project" : "global";
}

/** 当前会话 cwd（POST body 携带，宿主据此切换项目级 MCP）。 */
export function currentCwdBody(state: McpState): Record<string, string> {
  return typeof state.currentCwd === "string" && state.currentCwd !== ""
    ? { cwd: state.currentCwd }
    : {};
}

/** 是否处于编辑态（editingName 已设）。 */
export function isEditing(state: McpState): boolean {
  return state.editingName !== undefined;
}

/** 重置编辑态（表单已移除，只清编辑面）。 */
export function resetForm(state: McpState): void {
  state.editingName = undefined;
  state.editing = undefined;
}

/** 迁移式保存判据：正在编辑，且（改名 或 改归属）。宿主 PATCH 按 (scope,name) 定位且
 * 强制沿用定位名，故这两类改动必须走 POST+DELETE（见 performSaveRequest）。 */
export function isMigratedEdit(
  state: McpState,
  server: McpManagerServerInput,
  payload: Record<string, unknown>,
): boolean {
  const editingName = state.editingName;
  if (editingName === undefined) return false;
  const serverName = typeof server.name === "string" ? server.name : "";
  if (editingName !== serverName) return true;
  const editScope = state.editing?.scope;
  return editScope !== undefined && editScope !== payload.scope;
}

/** JSON 写请求的公共 init（PATCH / POST 共用）。 */
export function jsonWriteInit(payload: Record<string, unknown>): {
  method: "POST" | "PATCH";
  headers: Record<string, string>;
  body: string;
} {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  };
}

/**
 * 保存执行面（三种落点）与中止信号。
 * C11 迁移式保存：宿主 PATCH 按 (scope,name) 定位且强制沿用定位名——编辑改名/改归属
 * 会 404 not found 无引导。先 POST 新条目再 DELETE 旧条目，任何失败即抛（保留原条目），
 * 避免半迁移脏数据。
 * @returns false = 已中止（大声失败），调用方不得 refresh。
 */
export async function performSaveRequest(
  state: McpState,
  server: McpManagerServerInput,
  payload: Record<string, unknown>,
): Promise<boolean> {
  if (isMigratedEdit(state, server, payload)) {
    // #770-L2：改名/改归属迁移丢 stdio 秘密——POST 新条目无既有可沿用，
    // 省略的 env/headers 即永久丢失。M7 大声失败：原条目有秘密时无条件中止。
    // 文案须指引手动路径（新建同名条目填真值后删旧条目），不得承诺“重填后保存”
    // ——无条件拦截下该后续路径不存在，旧文案误导。
    if (state.editing?.hasSecrets === true) {
      window.alert(
        t("saveFail", {
          msg: "改名/改归属迁移不会带入原有凭据，请新建同名条目并填写真实凭据，确认可用后再删除旧条目",
        }),
      );
      return false;
    }
    await api<unknown>(state.API.servers, jsonWriteInit(payload));
    await api<unknown>(
      `${state.API.servers}?name=${encodeURIComponent(state.editingName ?? "")}&scope=${state.editing?.scope}`,
      { method: "DELETE" },
    );
    return true;
  }
  if (isEditing(state)) {
    const query = `name=${encodeURIComponent(state.editingName ?? "")}&scope=${formScopeValue(state)}`;
    await api<unknown>(`${state.API.servers}?${query}`, {
      ...jsonWriteInit(payload),
      method: "PATCH",
    });
    return true;
  }
  await api<unknown>(state.API.servers, jsonWriteInit(payload));
  return true;
}

/** 进入编辑模式：记录编辑态并弹出大号 JSON 编辑器（行内编辑太小，弃用表单填充）。 */
export function beginEdit(state: McpState, actions: UiActions, server: McpServerListEntry): void {
  state.editingName = server.name;
  state.editing = server;
  openJsonEditor(state, actions, server);
}

/** 可编辑字段投影（去掉 status/tools 等运行态只读面）。 */
function editorJson(server: McpServerListEntry): string {
  const out: Record<string, unknown> = { name: server.name, transport: server.transport };
  const copy = (key: keyof McpServerListEntry): void => {
    if (server[key] !== undefined) out[key as string] = server[key];
  };
  for (const key of [
    "command", "args", "env", "cwd", "url", "headers",
    "enabled", "toolCallTimeoutMs", "description",
  ] as const) {
    copy(key);
  }
  return JSON.stringify(out, null, 2);
}

/** 大号 JSON 编辑器弹层：整卡编辑单个服务器配置，保存走既有 PATCH 通道。 */
function openJsonEditor(state: McpState, actions: UiActions, server: McpServerListEntry): void {
  const overlay = el("div", {
    class: "dm-overlay dm-overlay--open",
    style: "z-index:10001",
  });
  const card = el("div", {
    class: "dm-card",
    style: "width:min(880px,94vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden",
  });
  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  document.addEventListener("keydown", onKey, true);
  const head = el("div", {
    class: "dm-head",
    style: "display:flex;align-items:center;justify-content:space-between;",
  });
  head.appendChild(el("h2", { style: "margin:0;", text: t("editServer", { name: server.name }) }));
  const closeBtn = el("button", { text: t("close"), onclick: close });
  head.appendChild(closeBtn);
  card.appendChild(head);
  const body = el("div", { class: "dm-body", style: "display:flex;flex-direction:column;gap:10px" });
  const area = el("textarea", {
    class: "dm-full",
    style:
      "flex:1;min-height:420px;width:100%;border:1px solid #d7dae0;border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.55;font-family:ui-monospace,Consolas,monospace;box-sizing:border-box;resize:vertical",
  });
  (area as HTMLTextAreaElement).value = editorJson(server);
  body.appendChild(area);
  const result = el("div", { class: "dm-result" });
  body.appendChild(result);
  const actionsRow = el("div", { class: "dm-actions" });
  actionsRow.appendChild(
    el("button", {
      class: "dm-primary",
      text: t("srcSave"),
      onclick: async () => {
        try {
          const payload = JSON.parse((area as HTMLTextAreaElement).value) as Record<string, unknown>;
          if (typeof payload.name === "string" && payload.name !== server.name) {
            throw new Error(t("jsonNameFixed"));
          }
          payload.name = server.name;
          payload.transport = server.transport;
          const ok = await performSaveRequest(
            state,
            server as unknown as McpManagerServerInput,
            payload,
          );
          if (!ok) return;
          result.textContent = t("srcSavedOk", { names: server.name });
          close();
          await actions.refresh();
        } catch (error) {
          result.textContent = t("importFail", {
            msg: error instanceof Error ? error.message : String(error),
          });
        }
      },
    }),
  );
  actionsRow.appendChild(el("button", { text: t("cancel"), onclick: close }));
  body.appendChild(actionsRow);
  card.appendChild(body);
  overlay.appendChild(card);
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });
  document.body.appendChild(overlay);
}

/** 构建「快速接入」页面（多源 mcp.json 编辑器）。 */
export function buildQuickAdd(state: McpState, actions: UiActions): HTMLElement {
  const page = el("div");

  // ── 多源 mcp.json 编辑器（全局/项目 × .agents/.dsh）──────
  // 快速接入页不再提供手填表单：四个声明来源各一个编辑器，保存即互斥同步。
  const srcSection = el("section", { class: "dm-section" });
  srcSection.appendChild(el("h3", { text: t("sourcesTitle") }));
  const srcHint = el("div", { class: "dm-result", text: "" });
  const srcBox = el("div", { class: "dm-paste-box" });
  const currentCwd = (): Record<string, unknown> => currentCwdBody(state);

  const loadSources = async () => {
    try {
      const payload = await api<{
        sources: { id: string; scope: string; path: string | null; exists: boolean; error: string | null; text: string | null }[];
        prefs: Record<string, string>;
      }>(
        `${state.API.sources}?cwd=${encodeURIComponent(String(currentCwd().cwd ?? ""))}`,
        { method: "GET" },
      );
      srcBox.innerHTML = "";
      for (const source of payload.sources) {
        const card = el("div", { class: "dm-server", style: "margin-bottom:14px;" });
        card.dataset.dmSrc = source.id;
        card.appendChild(el("div", {
          class: "dm-name",
          text: t(
            source.id === "global-agents" ? "srcGlobalAgents"
            : source.id === "global-dsh" ? "srcGlobalDsh"
            : source.id === "project-agents" ? "srcProjectAgents"
            : "srcProjectDsh",
          ),
        }));
        card.appendChild(el("div", {
          class: "dm-skip",
          text: (source.path ?? t("srcNeedSession")) + (source.exists ? "" : "（" + t("srcNotExists") + "）"),
        }));
        if (source.error !== null) {
          card.appendChild(el("div", { class: "dm-skip", text: t("importFail", { msg: source.error }) }));
        }
        const result = el("div", { class: "dm-result" });
        card.appendChild(result);
        card.appendChild(
          el("div", {
            class: "dm-actions",
            children: [
              el("button", {
                class: "dm-primary",
                text: t("srcEdit"),
                onclick: () => openSourceEditor(state, actions, source, currentCwd, result, loadSources),
              }),
            ],
          }),
        );
        srcBox.appendChild(card);
      }
      srcHint.textContent = "";
    } catch (error) {
      srcHint.textContent = t("importFail", { msg: error instanceof Error ? error.message : String(error) });
    }
  };

  srcSection.appendChild(srcHint);
  srcSection.appendChild(srcBox);
  void loadSources();
  page.appendChild(srcSection);

  return page;
}

/** 来源 mcp.json 大编辑器弹层：卡片只留「编辑」入口，点开整卡大编辑框（保存即互斥同步）。 */
function openSourceEditor(
  state: McpState,
  actions: UiActions,
  source: { id: string; path: string | null; exists: boolean; text: string | null },
  currentCwd: () => Record<string, unknown>,
  result: HTMLElement,
  onSaved: () => Promise<void>,
): void {
  const overlay = el("div", {
    class: "dm-overlay dm-overlay--open",
    style: "z-index:10001",
  });
  const card = el("div", {
    class: "dm-card",
    style: "width:min(880px,94vw);max-height:88vh;display:flex;flex-direction:column;overflow:hidden",
  });
  const close = (): void => {
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  document.addEventListener("keydown", onKey, true);
  const head = el("div", {
    class: "dm-head",
    style: "display:flex;align-items:center;justify-content:space-between;",
  });
  head.appendChild(el("h2", {
    style: "margin:0;",
    text:
      source.id === "global-agents" ? t("srcGlobalAgents")
      : source.id === "global-dsh" ? t("srcGlobalDsh")
      : source.id === "project-agents" ? t("srcProjectAgents")
      : t("srcProjectDsh"),
  }));
  const closeBtn = el("button", { text: t("close"), onclick: close });
  head.appendChild(closeBtn);
  card.appendChild(head);
  if (source.path !== null) {
    const pathLine = el("div", {
      class: "dm-skip",
      style:
        "margin:8px 0 10px;padding-left:24px;font-family:ui-monospace,Consolas,monospace;font-size:12px;",
      text: source.path,
    });
    card.appendChild(pathLine);
  }
  const body = el("div", { class: "dm-body", style: "display:flex;flex-direction:column;gap:10px" });
  const area = el("textarea", {
    class: "dm-full",
    style:
      "flex:1;min-height:420px;width:100%;border:1px solid #d7dae0;border-radius:8px;padding:10px 12px;font-size:13px;line-height:1.55;font-family:ui-monospace,Consolas,monospace;box-sizing:border-box;resize:vertical",
  });
  (area as HTMLTextAreaElement).value = source.text ?? "";
  body.appendChild(area);
  const modalResult = el("div", { class: "dm-result" });
  body.appendChild(modalResult);
  const actionsRow = el("div", { class: "dm-actions" });
  actionsRow.appendChild(
    el("button", {
      class: "dm-primary",
      text: t("srcSave"),
      onclick: async () => {
        try {
          const payload2 = await api<{ effective: { name: string }[]; removed: { name: string }[]; warnings: string[] }>(
            `${state.API.sourceSave}?${cwdQueryOf(state).replace(/^&/, "")}`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ id: source.id, text: (area as HTMLTextAreaElement).value, ...currentCwd() }),
            },
          );
          const names = payload2.effective.map((e) => e.name).join(", ") || t("importedNone");
          modalResult.textContent = t("srcSavedOk", { names });
          if (payload2.removed.length > 0) {
            modalResult.appendChild(el("div", { class: "dm-skip", text: t("srcMutexRemoved", { names: payload2.removed.map((r) => r.name).join(", ") }) }));
          }
          for (const warning of payload2.warnings) {
            modalResult.appendChild(el("div", { class: "dm-skip", text: warning }));
          }
          result.textContent = t("srcSavedOk", { names });
          await actions.refresh();
        } catch (error) {
          modalResult.textContent = t("importFail", { msg: error instanceof Error ? error.message : String(error) });
        }
      },
    }),
  );
  body.appendChild(actionsRow);
  card.appendChild(body);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}
