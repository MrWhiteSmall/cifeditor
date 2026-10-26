import assert from "node:assert/strict";
import test from "node:test";
import { connectionConfig, filterTools, type McpTool } from "../src/mcp/model.ts";

test("client configuration connects directly to the HTTP MCP endpoint", () => {
  assert.deepEqual(connectionConfig("http://localhost:7864/mcp"), {
    mcpServers: { cifeditor: { type: "http", url: "http://localhost:7864/mcp" } },
  });
});

test("configuration rejects non-HTTP URLs and embedded credentials", () => {
  for (const url of ["file:///tmp/a", "http://user:password@host", "http://host?token=secret", "http://host/#token", "invalid"]) {
    assert.throws(() => connectionConfig(url));
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
