import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const serviceWorker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("service worker caches shell assets but never API responses", () => {
  assert.match(serviceWorker, /atomworks_logo_dark\.svg/);
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(serviceWorker, /return;/);
});

test("MCP protocol GETs bypass the service worker instead of receiving cached HTML", () => {
  const handlers: Record<string, (event: unknown) => void> = {};
  runInNewContext(serviceWorker, {
    self: { location: {origin: "http://editor.test"}, addEventListener: (name: string, handler: (event: unknown) => void) => { handlers[name] = handler; } },
    URL,
  });
  for (const pathname of ["/mcp", "/mcp/"]) {
    let intercepted = false;
    handlers.fetch({request: {method: "GET", url: `http://editor.test${pathname}`}, respondWith: () => { intercepted = true; }});
    assert.equal(intercepted, false, pathname);
  }
});
