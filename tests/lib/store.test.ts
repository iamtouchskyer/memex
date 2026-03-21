import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore } from "../../src/lib/store.js";

describe("CardStore", () => {
  let tmpDir: string;
  let cardsDir: string;
  let archiveDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-test-"));
    cardsDir = join(tmpDir, "cards");
    archiveDir = join(tmpDir, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
    store = new CardStore(cardsDir, archiveDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("scanAll", () => {
    it("returns all .md files recursively", async () => {
      await writeFile(join(cardsDir, "a.md"), "---\ntitle: A\n---\n");
      await mkdir(join(cardsDir, "sub"), { recursive: true });
      await writeFile(join(cardsDir, "sub", "b.md"), "---\ntitle: B\n---\n");

      const files = await store.scanAll();
      const slugs = files.map((f) => f.slug).sort();
      expect(slugs).toEqual(["a", "sub/b"]);
    });

    it("returns empty array when no cards", async () => {
      const files = await store.scanAll();
      expect(files).toEqual([]);
    });
  });

  describe("resolve", () => {
    it("finds card by slug in flat directory", async () => {
      await writeFile(join(cardsDir, "test-card.md"), "content");
      const path = await store.resolve("test-card");
      expect(path).toBe(join(cardsDir, "test-card.md"));
    });

    it("finds card by slug in subdirectory", async () => {
      await mkdir(join(cardsDir, "sub"), { recursive: true });
      await writeFile(join(cardsDir, "sub", "nested.md"), "content");
      // slug must include the subdirectory path
      const path = await store.resolve("sub/nested");
      expect(path).toBe(join(cardsDir, "sub", "nested.md"));
    });

    it("does NOT find card by basename alone when stored in subdirectory", async () => {
      await mkdir(join(cardsDir, "sub"), { recursive: true });
      await writeFile(join(cardsDir, "sub", "nested.md"), "content");
      // bare basename lookup should return null (no ambiguity)
      const path = await store.resolve("nested");
      expect(path).toBeNull();
    });

    it("returns null when card not found", async () => {
      const path = await store.resolve("nonexistent");
      expect(path).toBeNull();
    });
  });

  describe("readCard", () => {
    it("reads card content", async () => {
      const content = "---\ntitle: Test\n---\nBody";
      await writeFile(join(cardsDir, "test.md"), content);
      const result = await store.readCard("test");
      expect(result).toBe(content);
    });

    it("throws when card not found", async () => {
      await expect(store.readCard("missing")).rejects.toThrow("Card not found: missing");
    });
  });

  describe("writeCard", () => {
    it("writes card to flat directory", async () => {
      const content = "---\ntitle: New\n---\nBody";
      await store.writeCard("new-card", content);
      const written = await readFile(join(cardsDir, "new-card.md"), "utf-8");
      expect(written).toBe(content);
    });

    it("overwrites existing card", async () => {
      await writeFile(join(cardsDir, "existing.md"), "old");
      await store.writeCard("existing", "new");
      const written = await readFile(join(cardsDir, "existing.md"), "utf-8");
      expect(written).toBe("new");
    });
  });

  describe("archiveCard", () => {
    it("moves card from cards to archive", async () => {
      await writeFile(join(cardsDir, "old.md"), "content");
      await store.archiveCard("old");

      const archivedPath = join(archiveDir, "old.md");
      const content = await readFile(archivedPath, "utf-8");
      expect(content).toBe("content");

      await expect(store.resolve("old")).resolves.toBeNull();
    });

    it("throws when card not found", async () => {
      await expect(store.archiveCard("missing")).rejects.toThrow("Card not found: missing");
    });
  });
});
