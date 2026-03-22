import { describe, it, expect } from "vitest";
import { GitAdapter } from "../../src/lib/sync.js";

describe("GitAdapter.pull", () => {
  it("returns success false when not configured", async () => {
    const adapter = new GitAdapter("/tmp/nonexistent-memex-test-" + Date.now());
    const result = await adapter.pull();
    expect(result.success).toBe(false);
  });
});

describe("GitAdapter.push", () => {
  it("returns success false when not configured", async () => {
    const adapter = new GitAdapter("/tmp/nonexistent-memex-test-" + Date.now());
    const result = await adapter.push();
    expect(result.success).toBe(false);
  });
});

describe("autoFetch", () => {
  it("is a no-op when sync not configured", async () => {
    const { autoFetch } = await import("../../src/lib/sync.js");
    await autoFetch("/tmp/nonexistent-memex-test-" + Date.now());
  });
});
