import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importCommand } from "../../src/commands/import.js";
import { CardStore } from "../../src/lib/store.js";

describe("importCommand", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-import-test-"));
    await mkdir(join(tmpDir, "cards"), { recursive: true });
    await mkdir(join(tmpDir, "archive"), { recursive: true });
    store = new CardStore(join(tmpDir, "cards"), join(tmpDir, "archive"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("lists available importers when no source given", async () => {
    const result = await importCommand(store, undefined, {});
    expect(result.success).toBe(true);
    expect(result.output).toContain("Available importers:");
    expect(result.output).toContain("openclaw");
  });

  it("returns error for unknown importer", async () => {
    const result = await importCommand(store, "nonexistent", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unknown importer: "nonexistent"');
    expect(result.error).toContain("openclaw");
  });

  it("returns error when source directory does not exist", async () => {
    const result = await importCommand(store, "openclaw", {
      dir: join(tmpDir, "does-not-exist"),
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Source directory not found");
  });

  it("imports sections from markdown files", async () => {
    const sourceDir = join(tmpDir, "source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "2026-05-25.md"),
      "## First Heading\n\nSome content here.\n\n## Second Heading\n\nMore content.\n"
    );

    const result = await importCommand(store, "openclaw", { dir: sourceDir });
    expect(result.success).toBe(true);
    expect(result.output).toContain("2 cards created");

    // Verify cards exist in store
    const card1 = await store.resolve("2026-05-25-first-heading");
    expect(card1).not.toBeNull();
    const card2 = await store.resolve("2026-05-25-second-heading");
    expect(card2).not.toBeNull();
  });

  it("skips already existing cards", async () => {
    const sourceDir = join(tmpDir, "source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "2026-01-01.md"),
      "## Existing Topic\n\nContent.\n"
    );

    // Pre-create the card
    await writeFile(
      join(tmpDir, "cards", "2026-01-01-existing-topic.md"),
      "---\ntitle: Existing Topic\n---\nOld content.\n"
    );

    const result = await importCommand(store, "openclaw", { dir: sourceDir });
    expect(result.success).toBe(true);
    expect(result.output).toContain("0 cards created, 1 skipped");
  });

  it("supports dry-run mode", async () => {
    const sourceDir = join(tmpDir, "source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "2026-03-15.md"),
      "## Dry Run Test\n\nShould not be written.\n"
    );

    const result = await importCommand(store, "openclaw", {
      dir: sourceDir,
      dryRun: true,
    });
    expect(result.success).toBe(true);
    expect(result.output).toContain("would be created");
    expect(result.output).toContain("[dry-run]");

    // Card should NOT be written
    const card = await store.resolve("2026-03-15-dry-run-test");
    expect(card).toBeNull();
  });

  it("skips files with no H2 sections", async () => {
    const sourceDir = join(tmpDir, "source");
    await mkdir(sourceDir, { recursive: true });
    await writeFile(
      join(sourceDir, "empty.md"),
      "# Only H1\n\nNo H2 sections here.\n"
    );

    const result = await importCommand(store, "openclaw", { dir: sourceDir });
    expect(result.success).toBe(true);
    expect(result.output).toContain("0 cards created, 0 skipped");
  });
});
