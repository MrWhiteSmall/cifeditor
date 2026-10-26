import assert from "node:assert/strict";
import test from "node:test";
import { connectionConfig, filterTools, type McpTool } from "../src/mcp/model.ts";

test("client configuration preserves spaces and quotes the SSH remote command", () => {
  assert.deepEqual(connectionConfig({ mode: "local", url: "http://localhost:7864/", executable: "/some path/mcp", host: "" }), {
    mcpServers: { cifeditor: { command: "/some path/mcp", args: ["--editor-url", "http://localhost:7864"] } },
  });
  const remote = connectionConfig({ mode: "ssh", url: "http://localhost:7864/", executable: "/some path/it's-mcp", host: "user@shenji" });
  assert.deepEqual(remote, { mcpServers: { cifeditor: { command: "ssh", args: ["-T", "user@shenji", "'/some path/it'\\''s-mcp' --editor-url 'http://localhost:7864'"] } } });
});

test("configuration rejects credentials and SSH options supplied as hostnames", () => {
  for (const url of ["file:///tmp/a", "http://user:password@host", "http://host?token=secret", "http://host/#token", "invalid"]) {
    assert.throws(() => connectionConfig({ mode: "local", url, executable: "mcp", host: "" }));
  }
  for (const host of ["-oProxyCommand=touch /tmp/a", "host;echo yes", "host\nwhoami"]) {
    assert.throws(() => connectionConfig({ mode: "ssh", url: "http://localhost", executable: "mcp", host }));
  }
});

test("tool search includes translated purposes and respects official read-only annotations", () => {
  const tools: McpTool[] = [
    { name: "query_selection", description: "Preview atoms", inputSchema: {}, annotations: { readOnlyHint: true } },
    { name: "delete_atoms", inputSchema: {}, annotations: { readOnlyHint: false } },
  ];
  const labels = (name: string): string => name === "query_selection" ? "预览选择" : "删除原子";
  assert.equal(filterTools(tools, "选择", "read", labels)[0].name, "query_selection");
  assert.equal(filterTools(tools, " DELETE ", "write", labels)[0].name, "delete_atoms");
  assert.deepEqual(filterTools(tools, "preview", "write", labels), []);
});
