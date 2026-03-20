import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { archiveCommand } from "../../src/commands/archive.js";
import { CardStore } from "../../src/lib/store.js";

describe("archiveCommand", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-"));
    await mkdir(join(tmpDir, "cards"), { recursive: true });
    await mkdir(join(tmpDir, "archive"), { recursive: true });
    store = new CardStore(join(tmpDir, "cards"), join(tmpDir, "archive"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("moves card to archive", async () => {
    await writeFile(join(tmpDir, "cards", "old.md"), "content");
    const result = await archiveCommand(store, "old");
    expect(result.success).toBe(true);
    const resolved = await store.resolve("old");
    expect(resolved).toBeNull();
    await expect(access(join(tmpDir, "archive", "old.md"))).resolves.toBeUndefined();
  });

  it("returns error for missing card", async () => {
    const result = await archiveCommand(store, "missing");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Card not found");
  });
});
