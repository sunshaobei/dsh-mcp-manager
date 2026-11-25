/**
 * dsh-mcp-manager — 从文件导入 mcpServers JSON 并合并到已有配置文本。
 *
 * 合并规则（用户契约）：
 * - 已有内容必须能解析；不能解析直接报错，不覆盖。
 * - 导入内容接受 `{ mcpServers: { ... } }` 或裸的 `{ name: config }` 映射。
 * - 同名服务器保留**已有**配置，计入 skipped；不同名追加。
 * - 保留已有文件的其它顶层键（如 $schema），只重写 mcpServers。
 */

export interface MergeImportResult {
  ok: boolean;
  text?: string;
  added: number;
  skipped: number;
  error?: string;
}

function asServerMap(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (
    typeof record.mcpServers === "object" &&
    record.mcpServers !== null &&
    !Array.isArray(record.mcpServers)
  ) {
    return record.mcpServers as Record<string, unknown>;
  }
  return record;
}

function validServers(map: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(map).filter(
      ([name, config]) =>
        name !== "" &&
        typeof config === "object" &&
        config !== null &&
        !Array.isArray(config),
    ),
  );
}

/** 合并导入文本；不改磁盘、不发请求（纯函数，单测直测）。 */
export function mergeMcpServersJson(
  existingText: string | null | undefined,
  importedText: string,
): MergeImportResult {
  let existing: Record<string, unknown>;
  try {
    const parsed = existingText === null || existingText === undefined || existingText.trim() === ""
      ? {}
      : JSON.parse(existingText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, added: 0, skipped: 0, error: "existing config is not a JSON object" };
    }
    existing = parsed as Record<string, unknown>;
  } catch (error) {
    return {
      ok: false,
      added: 0,
      skipped: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  let imported: Record<string, unknown>;
  try {
    const parsed = JSON.parse(importedText);
    const map = asServerMap(parsed);
    if (map === undefined) {
      return { ok: false, added: 0, skipped: 0, error: "imported JSON is not an object" };
    }
    imported = validServers(map);
  } catch (error) {
    return {
      ok: false,
      added: 0,
      skipped: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const current = validServers(asServerMap(existing) ?? {});
  let added = 0;
  let skipped = 0;
  for (const [name, config] of Object.entries(imported)) {
    if (Object.prototype.hasOwnProperty.call(current, name)) {
      skipped += 1;
      continue;
    }
    current[name] = config;
    added += 1;
  }
  const text = JSON.stringify({ ...existing, mcpServers: current }, null, 2) + "\n";
  return { ok: true, text, added, skipped };
}
