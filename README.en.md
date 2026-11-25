# @sunshaobei/dsh-mcp-manager

MCP server management for DSH: a floating pill, a left-sidebar entry and a settings-page
entry (each switchable), a full panel with a workspace picker, and one-click mcp.json file
import with merge.

## Install

```sh
dsh plugin --profile web add @sunshaobei/dsh-mcp-manager
```

Use `update` / `remove` to change it. Restart `dsh web` after install or update (bundle
layers are composed only at startup).

> DSH 0.2.2+ ships its own MCP manager and owns the cordis service name `mcpManager`.
> This plugin coexists under `mcpManagerPro`; the official component is left enabled.
> Other plugins should call `ctx.mcpManagerPro.registerServer(...)`.

## Entries

In **Plugins → MCP Manager → Configure**:

| Switch | Default | Behavior |
| --- | --- | --- |
| Floating pill | on | Pill + dropdown, follows the current session workspace |
| Left sidebar | off | Registers "MCP Manager" in the left sidebar |
| Settings page | off | Registers an "MCP Manager" settings section |

Config keys are `showFloat` / `showSidebar` / `showSettings`. Toggles save and apply
immediately. Position/offset/z-index still use **Save**. The sidebar
and settings panels carry a **workspace selector** ("global only" + registered workspaces);
the floating pill follows the session instead.

## Position

| Key | Values | Default |
| --- | --- | --- |
| `position` | `top-right` / `top-left` / `bottom-right` / `bottom-left` | `top-right` |
| `offset.x` / `offset.y` / `offset.blankY` | non-negative integers (px) | `8` / `8` / `40` |
| `zIndexBase` | 1-9000 | `10` |

Changes apply immediately, without restarting `dsh web`.

## Quick add

The Servers tab lists project/global servers with connect, disconnect, reconnect, enable,
disable and per-tool disable. Quick add manages four mcp.json sources:

- global `.dsh/mcp.json`, global `.agents/mcp.json`
- project `.dsh/mcp.json`, project `.agents/mcp.json` (shown for a selected workspace)

Each source supports **Edit** (edit JSON directly, save syncs) and **Import** (pick a local
JSON file; same-name servers keep the existing config, new names are appended, other
top-level keys are preserved).

## Storage

- Global: `<DSH_HOME>/dsh-mcp-manager/mcp.json`
- Project: `<project>/.dsh/dsh-mcp-manager/mcp.json`
- State: `user-state.json`, `stats.json`, `version`, catalog cache in the same directory.
- Config stores `${ENV}` references only, never secret values; files are 0600 and written
  atomically. stdio child environments are sanitized and error paths redacted.

## Model surface

Four atomic tools: `ws_mcp_list`, `ws_mcp_search`, `ws_mcp_detail`, `ws_mcp_call`. The host
registers internal `mcp__<id>__<tool>` names but removes them from the model tool list;
never call them directly.

## Boundaries

- There is no result truncation in this plugin; results are returned as-is.
- Timeouts are not a fixed value: 60s default, overridable per server with
  `toolCallTimeoutMs`; the middleware settles at the active servers' max + 25s.
- The host **denies by default** every direct `mcp__` call; the only path is `ws_mcp_call`.
- Call stats write hash buckets only, never raw arguments or returned content.

## Development

```sh
pnpm build
pnpm test
```

## License

MIT
