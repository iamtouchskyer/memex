import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CardStore, validateSlug } from "../../src/lib/store.js";

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
      expect(slugs).toEqual(["a", "b"]);
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
      const path = await store.resolve("nested");
      expect(path).toBe(join(cardsDir, "sub", "nested.md"));
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

  describe("writeCard slug validation", () => {
    it("rejects empty string slug", async () => {
      await expect(store.writeCard("", "content")).rejects.toThrow("must not be empty");
    });

    it("rejects whitespace-only slug", async () => {
      await expect(store.writeCard("   ", "content")).rejects.toThrow("must not be empty");
    });

    it("rejects tab-only slug", async () => {
      await expect(store.writeCard("\t\t", "content")).rejects.toThrow("must not be empty");
    });

    it("rejects slug consisting only of dots", async () => {
      await expect(store.writeCard("..", "content")).rejects.toThrow("only of dots and slashes");
    });

    it("rejects slug consisting only of dots and slashes", async () => {
      await expect(store.writeCard("./.", "content")).rejects.toThrow("only of dots and slashes");
    });

    it("rejects OS reserved characters", async () => {
      for (const ch of [':', '*', '?', '"', '<', '>', '|']) {
        await expect(store.writeCard(`bad${ch}slug`, "content")).rejects.toThrow("reserved characters");
      }
    });

    it("rejects leading slash", async () => {
      await expect(store.writeCard("/foo", "content")).rejects.toThrow("empty path segments");
    });

    it("rejects trailing slash", async () => {
      await expect(store.writeCard("foo/", "content")).rejects.toThrow("empty path segments");
    });

    it("rejects consecutive slashes", async () => {
      await expect(store.writeCard("a//b", "content")).rejects.toThrow("empty path segments");
    });

    it("rejects dot path segments", async () => {
      await expect(store.writeCard("a/../b", "content")).rejects.toThrow("must not be '.' or '..'");
    });

    it("rejects ./foo relative path", async () => {
      await expect(store.writeCard("./foo", "content")).rejects.toThrow("must not be '.' or '..'");
    });

    it("accepts valid simple slug", async () => {
      await store.writeCard("valid-slug", "content");
      const written = await readFile(join(cardsDir, "valid-slug.md"), "utf-8");
      expect(written).toBe("content");
    });

    it("accepts valid slug with subdirectory", async () => {
      await store.writeCard("sub/card", "content");
      const written = await readFile(join(cardsDir, "sub", "card.md"), "utf-8");
      expect(written).toBe("content");
    });
  });
});

describe("validateSlug (unit)", () => {
  it("throws on empty string", () => {
    expect(() => validateSlug("")).toThrow("must not be empty");
  });

  it("throws on whitespace-only", () => {
    expect(() => validateSlug("   ")).toThrow("must not be empty");
  });

  it("throws on dots-only", () => {
    expect(() => validateSlug("..")).toThrow("only of dots and slashes");
  });

  it("throws on reserved chars", () => {
    expect(() => validateSlug("a:b")).toThrow("reserved characters");
  });

  it("throws on empty path segments", () => {
    expect(() => validateSlug("a//b")).toThrow("empty path segments");
  });

  it("does not throw on valid slug", () => {
    expect(() => validateSlug("my-card")).not.toThrow();
    expect(() => validateSlug("sub/my-card")).not.toThrow();
    expect(() => validateSlug("a.b.c")).not.toThrow();
  });

  it("throws on backslash path traversal", () => {
    expect(() => validateSlug("a\\..\\b")).toThrow("path segments must not be");
  });

  it("throws on leading backslash", () => {
    expect(() => validateSlug("\\foo")).toThrow("empty path segments");
  });

  it("throws on trailing backslash", () => {
    expect(() => validateSlug("foo\\")).toThrow("empty path segments");
  });

  it("throws on double backslash", () => {
    expect(() => validateSlug("a\\\\b")).toThrow("empty path segments");
  });

  it("throws on dots-and-backslashes-only", () => {
    expect(() => validateSlug(".\\..")).toThrow("only of dots and slashes");
  });

  it("throws on leading slash", () => {
    expect(() => validateSlug("/foo")).toThrow("empty path segments");
  });

  it("throws on dot-dot path segment with forward slash", () => {
    expect(() => validateSlug("a/../b")).toThrow("path segments must not be");
  });
});
