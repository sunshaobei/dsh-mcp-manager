# @sunshaobei/dsh-mcp-manager

DSH 的 MCP 服务器管理插件：右上角浮窗、左侧导航入口、设置页入口三个独立开关；完整管理
面板可选工作区；支持表单/JSON 接入与**本地 mcp.json 文件一键导入（与已有内容合并）**。

## 安装

```sh
dsh plugin --profile web add @sunshaobei/dsh-mcp-manager
```

更新/卸载把 `add` 换成 `update` / `remove`。安装、更新后重启一次 `dsh web`（bundle 层
只在启动时组合）。

> DSH 0.2.2+ 自带官方 MCP 管理器并占用 cordis 服务名 `mcpManager`。本插件与之**共存**，
> 自己的服务名是 `mcpManagerPro`，不抢占、也不停用官方组件；其他插件请使用
> `ctx.mcpManagerPro.registerServer(...)`。

## 三个入口

在 **插件 → MCP 管理器 → 配置** 中：

| 开关 | 默认 | 行为 |
| --- | --- | --- |
| 右上角浮窗 | 开 | 胶囊 + 下拉面板，跟随当前会话工作区 |
| 左侧导航入口 | 关 | 注册「MCP 管理器」到左侧导航，完整管理面板 |
| 设置页入口 | 关 | 在设置侧栏注册「MCP 管理器」一节 |

配置键为 `showFloat` / `showSidebar` / `showSettings`。勾选即保存并立即生效；
位置/偏移/层级仍点「保存」。左侧导航与设置页的面板顶部有
**工作区下拉**（「仅全局」+ 已登记工作区），不跟随会话，显式选择要管理的项目配置。

## 浮窗位置

| 键 | 值域 | 默认 |
| --- | --- | --- |
| `position` | `top-right` / `top-left` / `bottom-right` / `bottom-left` | `top-right` |
| `offset.x` / `offset.y` / `offset.blankY` | 非负整数（px） | `8` / `8` / `40` |
| `zIndexBase` | 1–9000 | `10` |

保存后即时生效，无需重启 `dsh web`。

## 快速接入

「服务器」页展示项目级/全局服务器，可连接、断开、重连、启用/停用、禁用单个工具。
「快速接入」页管理四个 mcp.json 声明来源：

- 全局 `.dsh/mcp.json`、全局 `.agents/mcp.json`
- 项目 `.dsh/mcp.json`、项目 `.agents/mcp.json`（选中具体工作区时显示）

每个来源支持：

- **编辑**：直接编辑 JSON，保存即互斥同步。
- **导入**：选择本地 JSON 文件，与已有内容合并。同名服务器保留已有配置，新名称追加，
  其他顶层键（如 `$schema`）保留。

## 配置与存储

- 服务器配置：`<DSH_HOME>/dsh-mcp-manager/mcp.json`（全局）、
  `<项目根>/.dsh/dsh-mcp-manager/mcp.json`（项目）。
- 插件状态：同目录的 `user-state.json`、`stats.json`、`version`、目录缓存。
- 配置只存 `${ENV}` 引用，不落盘密钥原文；文件 0600 + 原子写。
- stdio 子进程环境净化；目录摘要与错误路径脱敏。

## 模型可见面

模型只看到四个原子工具：

- `ws_mcp_list`：盘点当前工作空间全部服务器与工具。
- `ws_mcp_search`：按关键词搜服务器/工具。
- `ws_mcp_detail`：按需拉取完整工具 schema。
- `ws_mcp_call`：按 `@<root>/<server>` + 裸工具名调用。

宿主内部注册名 `mcp__<id>__<tool>` 是内部标识，会从模型工具列表摘除，禁止直呼。

## 路由

`/api/dsh-mcp/*` 仅供本地面板使用，非回环 403、方法不匹配 405。主要端点：

| 路由 | 说明 |
| --- | --- |
| `/api/dsh-mcp/servers` | 服务器列表与增删改 |
| `/api/dsh-mcp/servers/connect` 等 | 连接控制 |
| `/api/dsh-mcp/sources` / `sources/save` | mcp.json 来源读写 |
| `/api/dsh-mcp/import/json` | 粘贴 mcpServers JSON 导入 |
| `/api/dsh-mcp/workspaces` | 嵌入面板的工作区下拉 |
| `/api/dsh-mcp/config` | 三个入口开关与浮窗位置 |
| `/api/dsh-mcp/health` / `events` | 健康检查 / SSE |

## 边界

- 本插件**不做结果截断**，工具结果原样返回；需要限长请在 MCP 服务器或宿主策略里做。
- 超时不是固定值：默认 60s，可按服务器 `toolCallTimeoutMs` 覆盖；中间层 `ws_mcp_call`
  按在用服务器的最大值 + 25s 内部尾结算。
- 模型直呼 `mcp__` 注册名**默认拒绝**，唯一通路是 `ws_mcp_call`。
- 调用统计只写哈希桶，不持久化原始 arguments / 返回 content。

## 开发

```sh
pnpm build
pnpm test
```

## License

MIT
