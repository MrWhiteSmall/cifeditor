import assert from "node:assert/strict";
import test from "node:test";
import { SharedSessionSync } from "../src/studio/shared-session.ts";

test("external changes refresh once, unchanged revisions leave the view alone", async () => {
  let revision = 1;
  let refreshes = 0;
  const sync = new SharedSessionSync({
    current: () => ({ sessionId: "one", revision }), enabled: () => true,
    revision: async () => 2,
    refresh: async () => { refreshes++; revision = 2; }, status: () => {},
  });
  await sync.check();
  await sync.check();
  assert.equal(refreshes, 1);
});

test("responses from a previous document cannot refresh the new document", async () => {
  let current = { sessionId: "one", revision: 0 };
  let resolve!: (value: number) => void;
  const sync = new SharedSessionSync({
    current: () => current, enabled: () => true,
    revision: () => new Promise<number>(done => { resolve = done; }),
    refresh: async () => { assert.fail("stale session refreshed"); }, status: () => {},
  });
  const pending = sync.check();
  current = { sessionId: "two", revision: 0 };
  resolve(1);
  await pending;
});

test("paused sync and overlapping polls do not start refreshes", async () => {
  let enabled = false;
  let requests = 0;
  let resolve!: (value: number) => void;
  const sync = new SharedSessionSync({
    current: () => ({ sessionId: "one", revision: 0 }), enabled: () => enabled,
    revision: () => { requests++; return new Promise<number>(done => { resolve = done; }); },
    refresh: async () => { assert.fail("paused sync refreshed"); }, status: () => {},
  });
  await sync.check();
  assert.equal(requests, 0);
  enabled = true;
  const pending = sync.check();
  await sync.check();
  assert.equal(requests, 1);
  enabled = false;
  resolve(1);
  await pending;
});

test("a local edit completed during polling is compared against its latest revision", async () => {
  let revision = 0;
  let resolve!: (value: number) => void;
  const sync = new SharedSessionSync({
    current: () => ({ sessionId: "one", revision }), enabled: () => true,
    revision: () => new Promise<number>(done => { resolve = done; }),
    refresh: async () => { assert.fail("already refreshed local edit"); }, status: () => {},
  });
  const pending = sync.check();
  revision = 1;
  resolve(1);
  await pending;
});

test("network failures release the poll guard and recover on the next check", async () => {
  let failed = true;
  const statuses: string[] = [];
  const sync = new SharedSessionSync({
    current: () => ({ sessionId: "one", revision: 0 }), enabled: () => true,
    revision: async () => { if (failed) throw new Error("offline"); return 0; },
    refresh: async () => {}, status: value => statuses.push(value),
  });
  await sync.check();
  failed = false;
  await sync.check();
  assert.deepEqual(statuses, ["offline", "synced"]);
});
