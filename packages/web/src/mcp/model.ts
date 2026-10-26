export interface McpTool {
  name: string;
  description?: string;
  inputSchema: { properties?: Record<string, Record<string, unknown>>; required?: string[]; [key: string]: unknown };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  [key: string]: unknown;
}

export function connectionConfig(endpoint: string): object {
  const url = new URL(endpoint);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) MCP endpoint without credentials, query or fragment.");
  }
  return { mcpServers: { cifeditor: { type: "http", url: url.href } } };
}

export function filterTools(tools: McpTool[], query: string, type: string, summary: (name: string) => string): McpTool[] {
  const search = query.trim().toLocaleLowerCase();
  return tools.filter(tool => (type === "all" || (type === "read") === (tool.annotations?.readOnlyHint === true))
    && `${tool.name} ${tool.description ?? ""} ${summary(tool.name)}`.toLocaleLowerCase().includes(search));
}
