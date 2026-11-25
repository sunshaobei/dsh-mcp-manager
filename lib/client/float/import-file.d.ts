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
/** 合并导入文本；不改磁盘、不发请求（纯函数，单测直测）。 */
export declare function mergeMcpServersJson(existingText: string | null | undefined, importedText: string): MergeImportResult;
