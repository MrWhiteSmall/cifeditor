export interface McpTool {
  name: string;
  description?: string;
  inputSchema: { properties?: Record<string, Record<string, unknown>>; required?: string[]; [key: string]: unknown };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  [key: string]: unknown;
}

export interface ConnectionOptions { mode: string; url: string; executable: string; host: string }

/** SSH reconstructs a shell command from arguments; quote remote values explicitly. */
function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }

export function connectionConfig(options: ConnectionOptions): object {
  const url = new URL(options.url);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Use an HTTP(S) base URL without credentials, query or fragment.");
  }
  const executable = options.executable.trim();
  if (!executable || /[\r\n\0]/.test(executable)) throw new Error("Enter the adapter executable path.");
  const base = url.href.replace(/\/$/, "");
  let command = executable;
  let args = ["--editor-url", base];
  if (options.mode === "ssh") {
    const host = options.host.trim();
    if (!/^[A-Za-z0-9_][A-Za-z0-9_.@:-]*$/.test(host)) throw new Error("Enter a valid SSH host or alias.");
    command = "ssh";
    args = ["-T", host, `${shellQuote(executable)} --editor-url ${shellQuote(base)}`];
  }
  return { mcpServers: { cifeditor: { command, args } } };
}

export function filterTools(tools: McpTool[], query: string, type: string, summary: (name: string) => string): McpTool[] {
  const search = query.trim().toLocaleLowerCase();
  return tools.filter(tool => (type === "all" || (type === "read") === (tool.annotations?.readOnlyHint === true))
    && `${tool.name} ${tool.description ?? ""} ${summary(tool.name)}`.toLocaleLowerCase().includes(search));
}
