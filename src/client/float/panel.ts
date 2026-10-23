/**
 * dsh-mcp-manager — 客户端模态面板生命周期。
 *
 * 面板的打开/关闭/tab 切换/数据刷新。
 * 跨模块渲染（renderServers / buildQuickAdd / renderPill / renderFloatPanel）
 * 直接 import 用到的模块——本模块是 feature 模块的汇聚点，构成单向依赖图：
 * panel → servers / quick-add / float。
 */

import { el } from "../core/dom.ts";
import { api } from "../core/api.ts";
import { t } from "../../vendor/shared/client/i18n.js";
import type { McpCounts, McpServerListEntry, McpState, UiActions } from "../core/state.ts";
import { renderServers } from "./servers.ts";
import { buildQuickAdd } from "./quick-add.ts";
import { renderPill, renderFloatPanel } from "./float.ts";

/** 模块级单飞去重句柄（invalidate 单飞：同一时刻只有一个 in-flight 拉取）。 */
const inflight = new WeakMap<McpState, Map<string, Promise<boolean>>>();
const snapshots = new WeakMap<McpState, Map<string, {
  servers: McpServerListEntry[]; counts: McpCounts; projectRoot?: string;
}>>();

/** Switch immediately to this workspace's snapshot; never display another workspace's counts. */
export function activateWorkspace(state: McpState, actions: UiActions, previous?: string): void {
  let cache = snapshots.get(state);
  if (cache === undefined) snapshots.set(state, cache = new Map());
  if (Array.isArray(state.servers) && previous !== undefined) {
    cache.set(previous, { servers: state.servers, counts: state.counts, projectRoot: state.projectRoot });
  }
  const next = state.sessionResolved ? cache.get(state.currentCwd ?? "") : undefined;
  state.servers = next?.servers ?? [];
  state.counts = next?.counts ?? {};
  state.projectRoot = next?.projectRoot;
  renderPill(state);
  renderCountsBadge(state);
  // Session-store subscriptions must not rebuild a potentially large tool list on the loading stack.
  if (state.bodyEl !== undefined && state.activeTab === "servers") state.bodyEl.textContent = "";
  if (state.floatOpen && state.floatPanel !== undefined) state.floatPanel.textContent = "";
  const cwd = state.currentCwd;
  setTimeout(() => {
    if (state.currentCwd !== cwd) return;
    if (state.floatOpen) renderFloatPanel(state, actions);
    if (state.bodyEl !== undefined && state.activeTab === "servers") renderServers(state, actions);
  }, 0);
}

/** C4：Escape keydown 清理回调登记（WeakMap 避免污染 McpState 接口）。 */
const keydownCleanups = new WeakMap<McpState, () => void>();

/**
 * 刷新服务器列表与浮窗摘要（单飞：in-flight 复用；#111 变更点驱动）。
 * 返回 true=成功；false=失败（调用方按退避重试）。
 */
export function refresh(state: McpState, actions: UiActions): Promise<boolean> {
  if (!state.sessionResolved) return Promise.resolve(true);
  const key = state.currentCwd ?? "";
  let pending = inflight.get(state);
  if (pending === undefined) inflight.set(state, pending = new Map());
  const existing = pending.get(key);
  if (existing !== undefined) return existing;
  const request = doRefresh(state, actions, key).finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}

/** 健康摘要文案：按 counts 逐档拼段，无段时退到「共 N 台」。缺档位按 0 读（服务端省略未发生的档）。 */
function countsSummaryText(state: McpState): string {
  const parts: string[] = [];
  const { connected = 0, connecting = 0, reconnecting = 0, failed = 0 } = state.counts;
  if (connected > 0) parts.push(t("countsConnected", { n: connected }));
  if (connecting > 0 || reconnecting > 0)
    parts.push(t("countsConnecting", { n: connecting + reconnecting }));
  if (failed > 0) parts.push(t("countsFailed", { n: failed }));
  return parts.length > 0
    ? t("countsSummary", { n: state.servers.length, parts: parts.join(" · ") })
    : t("countsSummaryOnly", { n: state.servers.length });
}

/** 健康摘要徽标（面板头 .dm-counts）：文案由 countsSummaryText 给；失败计数在文案里就地
 *  标红（与浮窗同语义）。徽标缺席（面板头未建）时静默跳过。 */
function renderCountsBadge(state: McpState): void {
  if (typeof document === "undefined") return;
  const countsEl = document.querySelector(".dm-counts");
  if (countsEl === null) return;
  const summary = countsSummaryText(state);
  const failed = state.counts.failed ?? 0;
  if (failed > 0 && typeof summary === "string") {
    const failedText = t("countsFailed", { n: failed });
    countsEl.textContent = "";
    summary.split(failedText).forEach((chunk, index) => {
      if (index > 0) {
        countsEl.appendChild(el("span", { class: "dm-health-bad", text: failedText }));
      }
      if (chunk !== "") countsEl.appendChild(document.createTextNode(chunk));
    });
    return;
  }
  countsEl.textContent = summary;
}

/** 实际拉取（单飞内部）。 */
async function doRefresh(state: McpState, actions: UiActions, cwd: string): Promise<boolean> {
  try {
    // cwd selects a request-owned, cached workspace view. GET never changes the selected session,
    // synchronizes configuration, or checks connections. Late responses cannot replace another view.
    const payload = await api<{
      servers?: McpServerListEntry[];
      counts?: McpCounts;
      projectRoot?: string;
    }>(`${state.API.servers}?cwd=${encodeURIComponent(cwd)}`);
    if (!state.sessionResolved || (state.currentCwd ?? "") !== cwd) return true;
    state.servers = payload.servers ?? [];
    state.counts = payload.counts ?? {};
    state.projectRoot = payload.projectRoot;
    renderPill(state);
    if (state.floatOpen) renderFloatPanel(state, actions);
    renderCountsBadge(state);
    if (state.bodyEl !== undefined && state.activeTab === "servers") renderServers(state, actions);
    return true;
  } catch (error) {
    if ((state.currentCwd ?? "") !== cwd) return false;
    if (state.bodyEl !== undefined && state.activeTab === "servers") {
      state.bodyEl.textContent = "";
      state.bodyEl.appendChild(
        el("div", {
          class: "dm-status",
          text: t("loadFail", { msg: error instanceof Error ? error.message : String(error) }),
        }),
      );
    }
    return false;
  }
}

/** 切换面板 tab（servers / quick）。 */
export function switchTab(state: McpState, actions: UiActions, tab: string): void {
  state.activeTab = tab;
  for (const tabEl of state.card?.querySelectorAll<HTMLElement>(".dm-tab") ?? []) {
    const active = tabEl.dataset.tab === tab;
    if (active) tabEl.dataset.active = "true";
    else delete tabEl.dataset.active;
    tabEl.setAttribute("aria-pressed", String(active));
  }
  if (state.bodyEl === undefined) return;
  state.bodyEl.textContent = "";
  if (tab === "servers") {
    if (state.servers.length === 0) void refresh(state, actions);
    else renderServers(state, actions);
  } else {
    const page = buildQuickAdd(state, actions);
    state.bodyEl.appendChild(page);
  }
}

/** 关闭模态面板（Fluid：卡片中心收束 + 遮罩淡出；完成后再 hidden）。
 *
 * R1 状态同翻：state.open=false 的同一同步块内摘除 aria-modal（不经 300ms
 * 动画回调——动画被打断/定时器漂移时标记与状态永久错位，见 #947）。
 * R2 常驻壳无标记：hidden 元素仍被 querySelector 命中，故必须摘属性而非
 * 置 "false"（裸 [aria-modal] 存在检查仍命中 "false"，且关闭态留 "false"
 * 语义错误）。R6 关还焦：同步把焦点还给打开者（便宜且安全）。
 */
export function close(state: McpState): void {
  if (state.overlay === undefined) return;
  state.open = false;
  // 与 state.open 同步翻转：card 缺失属创建/销毁不对称，显式分支不断言静默。
  if (state.card !== undefined) state.card.removeAttribute("aria-modal");
  // R6 还焦：opener 仍在文档内才恢复（已卸载/非元素则跳过，不抛）。
  const opener = state.panelOpener;
  state.panelOpener = undefined;
  if (opener !== undefined && opener !== null && typeof opener.focus === "function") {
    try {
      if (typeof opener.isConnected !== "boolean" || opener.isConnected) {
        opener.focus({ preventScroll: true });
      }
    } catch {
      // 焦点恢复失败不影响关闭语义，只 warn 不抛（绝不让 GUI 挂掉）。
      console.warn("[dsh-mcp-manager] panel opener focus restore skipped");
    }
  }
  const overlay = state.overlay;
  overlay.classList.remove("dm-overlay--open");
  const finish = () => {
    if (state.open) return;
    overlay.classList.remove("dm-overlay--closing");
    overlay.hidden = true;
  };
  if (typeof requestAnimationFrame === "function") {
    overlay.style.animation = "none";
    void overlay.offsetWidth;
    overlay.style.animation = "";
    overlay.classList.add("dm-overlay--closing");
    // 与 CSS .dm-overlay--closing .dm-card 的 300ms 对齐
    window.setTimeout(finish, 300);
  } else {
    finish();
  }
}

/** 打开模态面板（首次调用时创建 DOM 结构；Fluid：中心 scale 0.78→1）。 */
export function showPanel(state: McpState, actions: UiActions): void {
  if (state.overlay === undefined) {
    state.overlay = el("div", { class: "dm-overlay", hidden: true });
    state.overlay!.addEventListener("click", (event: MouseEvent) => {
      if (event.target === state.overlay) close(state);
    });
    state.card = el("div", { class: "dm-card dm-manager-panel" });

    const head = el("div", { class: "dm-head" });
    head.appendChild(el("h2", { text: t("panelTitle") }));
    head.appendChild(el("span", { class: "dm-counts", text: "" }));
    head.appendChild(
      el("button", { text: t("refresh"), onclick: () => void refresh(state, actions) }),
    );
    // C10：首次构建面板头后立刻拉一次（与打开路径 refresh 同源，单飞去重）。
    void refresh(state, actions);
    head.appendChild(el("button", { text: t("close"), onclick: () => close(state) }));
    state.card!.appendChild(head);
    // role 保留（静态语义；hidden 子树 AT-irrelevant）。aria-modal 不在此写：
    // 单点写入见本函数公共路径（state.open=true 后无条件 set），与 close() 的
    // 同步 removeAttribute 配对（R1），两处写同一值会漂移。
    state.card!.setAttribute("role", "dialog");
    state.card!.setAttribute("aria-label", t("panelTitle"));

    const tabs = el("div", { class: "dm-tabs" });
    tabs.appendChild(
      el("button", {
        class: "dm-tab",
        dataset: { tab: "servers" },
        text: t("tabServers"),
        onclick: () => switchTab(state, actions, "servers"),
      }),
    );
    tabs.appendChild(
      el("button", {
        class: "dm-tab",
        dataset: { tab: "quick" },
        text: t("tabQuickAdd"),
        onclick: () => switchTab(state, actions, "quick"),
      }),
    );
    state.card!.appendChild(tabs);

    state.bodyEl = el("div", { class: "dm-body" });
    state.card!.appendChild(state.bodyEl!);
    state.overlay!.appendChild(state.card!);
    document.body.appendChild(state.overlay!);

    // C4 keydown 泄漏修复：Escape 监听改具名函数并经 WeakMap 登记清理
    // 回调（disposePanel 配对 removeEventListener）——匿名监听器在 HMR/重复
    // apply 下无移除路径，会随每次 apply 累积。
    const onKeyDown = (event: KeyboardEvent) => {
      // R4 共享键让位：他人已 preventDefault 即不再关（多弹窗可组合）。
      if (event.defaultPrevented) return;
      if (event.key === "Escape" && state.open) close(state);
    };
    document.addEventListener("keydown", onKeyDown);
    keydownCleanups.set(state, () => document.removeEventListener("keydown", onKeyDown));
  }
  // R6 记录 opener（当前聚焦元素；body/非元素由 close() 侧守卫过滤）。
  // 进焦不做（R6：聚关闭按钮以外的文本控件会唤起移动端键盘+布局跳动）。
  // 已 open 时重入不覆写：焦点已在面板内，重记会把还焦落到 hidden 子树节点。
  if (!state.open) {
    state.panelOpener =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : undefined;
  }
  state.open = true;
  // R1 单点写入：重开路径（含 close→300ms 内重开竞态）一律恢复 true，与
  // close() 的同步摘除配对，幂等。
  if (state.card !== undefined) state.card.setAttribute("aria-modal", "true");
  state.overlay!.hidden = false;
  state.overlay!.classList.remove("dm-overlay--closing");
  const armOpen = () => {
    if (!state.open || state.overlay === undefined) return;
    state.overlay.style.animation = "none";
    void state.overlay.offsetWidth;
    state.overlay.style.animation = "";
    state.overlay.classList.add("dm-overlay--open");
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(armOpen);
  else armOpen();
  // C10：面板打开主动刷新（refresh 单飞去重，与 switchTab 的空列表刷新重叠无害）——
  // 面板可能停在关闭期间的旧快照上；打开即拉最新数据消除该窗口。
  void refresh(state, actions);
  switchTab(state, actions, "servers");
}

/** C4：卸载配对清理（index.ts effect disposer 调用）——移除 Escape keydown 监听。 */
export function disposePanel(state: McpState): void {
  const cleanup = keydownCleanups.get(state);
  if (cleanup !== undefined) {
    cleanup();
    keydownCleanups.delete(state);
  }
}
