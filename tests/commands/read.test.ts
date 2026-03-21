import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readCommand } from "../../src/commands/read.js";
import { CardStore } from "../../src/lib/store.js";

describe("readCommand", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-"));
    const cardsDir = join(tmpDir, "cards");
    await mkdir(cardsDir, { recursive: true });
    store = new CardStore(cardsDir, join(tmpDir, "archive"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads existing card content", async () => {
    const content = "---\ntitle: Test\n---\nBody content.";
    await writeFile(join(tmpDir, "cards", "test.md"), content);
    const result = await readCommand(store, "test");
    expect(result.success).toBe(true);
    expect(result.content).toBe(content);
  });

  it("returns error for missing card", async () => {
    const result = await readCommand(store, "missing");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Card not found: missing");
  });

  it("finds card in subdirectory using full slug path", async () => {
    await mkdir(join(tmpDir, "cards", "sub"), { recursive: true });
    await writeFile(join(tmpDir, "cards", "sub", "nested.md"), "content");
    // slug must include the subdirectory prefix
    const result = await readCommand(store, "sub/nested");
    expect(result.success).toBe(true);
    expect(result.content).toBe("content");
  });

  it("returns error when reading subdirectory card with bare basename", async () => {
    await mkdir(join(tmpDir, "cards", "sub"), { recursive: true });
    await writeFile(join(tmpDir, "cards", "sub", "nested.md"), "content");
    const result = await readCommand(store, "nested");
    expect(result.success).toBe(false);
  });
});
