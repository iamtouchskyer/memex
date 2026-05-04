import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EmbeddingCache,
  cosineSimilarity,
  contentHash,
  embedCards,
  type EmbeddingProvider,
} from "../../src/lib/embeddings.js";
import { CardStore } from "../../src/lib/store.js";

// --- cosineSimilarity ---

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = [1, 2, 3];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1);
  });

  it("returns 0 when either vector is zero", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  it("handles arbitrary vectors correctly", () => {
    // cos([1,2,3], [4,5,6]) = 32 / (sqrt(14)*sqrt(77))
    const expected = 32 / (Math.sqrt(14) * Math.sqrt(77));
    expect(cosineSimilarity([1, 2, 3], [4, 5, 6])).toBeCloseTo(expected);
  });
});

// --- EmbeddingCache ---

describe("EmbeddingCache", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-embed-cache-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("starts empty and needsUpdate returns true", () => {
    const cache = new EmbeddingCache(tmpDir, "test-model");
    expect(cache.get("foo")).toBeUndefined();
    expect(cache.needsUpdate("foo", "abc")).toBe(true);
  });

  it("set/get round-trips correctly", () => {
    const cache = new EmbeddingCache(tmpDir, "test-model");
    cache.set("card-a", [1, 2, 3], "hash-a");
    const entry = cache.get("card-a");
    expect(entry).toBeDefined();
    expect(entry!.vector).toEqual([1, 2, 3]);
    expect(entry!.contentHash).toBe("hash-a");
  });

  it("needsUpdate detects hash changes", () => {
    const cache = new EmbeddingCache(tmpDir, "test-model");
    cache.set("card-a", [1], "hash-old");
    expect(cache.needsUpdate("card-a", "hash-old")).toBe(false);
    expect(cache.needsUpdate("card-a", "hash-new")).toBe(true);
  });

  it("remove deletes an entry", () => {
    const cache = new EmbeddingCache(tmpDir, "test-model");
    cache.set("card-a", [1], "h");
    cache.remove("card-a");
    expect(cache.get("card-a")).toBeUndefined();
  });

  it("save/load persists to disk", async () => {
    const cache = new EmbeddingCache(tmpDir, "test-model");
    cache.set("card-a", [1, 2], "ha");
    cache.set("card-b", [3, 4], "hb");
    await cache.save();

    const cache2 = new EmbeddingCache(tmpDir, "test-model");
    await cache2.load();
    expect(cache2.get("card-a")!.vector).toEqual([1, 2]);
    expect(cache2.get("card-b")!.contentHash).toBe("hb");
  });

  it("load ignores mismatched model", async () => {
    const cache = new EmbeddingCache(tmpDir, "model-a");
    cache.set("x", [1], "h");
    await cache.save();

    const cache2 = new EmbeddingCache(tmpDir, "model-b");
    await cache2.load();
    expect(cache2.get("x")).toBeUndefined();
  });

  it("load handles missing file gracefully", async () => {
    const cache = new EmbeddingCache(tmpDir, "test-model");
    await cache.load(); // should not throw
    expect(cache.slugs()).toEqual([]);
  });
});

// --- contentHash ---

describe("contentHash", () => {
  it("returns consistent SHA-256 hex digest", () => {
    const h1 = contentHash("hello world");
    const h2 = contentHash("hello world");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it("returns different hashes for different content", () => {
    expect(contentHash("a")).not.toBe(contentHash("b"));
  });
});

// --- embedCards ---

describe("embedCards", () => {
  let tmpDir: string;
  let cardsDir: string;
  let archiveDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-embed-cards-"));
    cardsDir = join(tmpDir, "cards");
    archiveDir = join(tmpDir, "archive");
    await mkdir(cardsDir, { recursive: true });
    await mkdir(archiveDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  function mockProvider(): EmbeddingProvider {
    return {
      model: "mock-model",
      async embed(texts: string[]): Promise<number[][]> {
        // Return a deterministic fake vector per text (length 3 for simplicity)
        return texts.map((t) => {
          const h = contentHash(t);
          return [
            parseInt(h.slice(0, 8), 16) / 0xffffffff,
            parseInt(h.slice(8, 16), 16) / 0xffffffff,
            parseInt(h.slice(16, 24), 16) / 0xffffffff,
          ];
        });
      },
    };
  }

  it("embeds all cards on first run", async () => {
    await writeFile(join(cardsDir, "alpha.md"), "Card alpha content");
    await writeFile(join(cardsDir, "beta.md"), "Card beta content");

    const store = new CardStore(cardsDir, archiveDir);
    const cache = new EmbeddingCache(tmpDir, "mock-model");
    const provider = mockProvider();

    const result = await embedCards(store, provider, cache);

    expect(result.embedded).toBe(2);
    expect(result.removed).toBe(0);
    expect(result.total).toBe(2);
    expect(cache.get("alpha")).toBeDefined();
    expect(cache.get("beta")).toBeDefined();
  });

  it("skips unchanged cards on second run", async () => {
    await writeFile(join(cardsDir, "alpha.md"), "Card alpha");

    const store = new CardStore(cardsDir, archiveDir);
    const cache = new EmbeddingCache(tmpDir, "mock-model");
    const provider = mockProvider();

    await embedCards(store, provider, cache);
    const result2 = await embedCards(store, provider, cache);

    expect(result2.embedded).toBe(0);
    expect(result2.total).toBe(1);
  });

  it("re-embeds cards whose content changed", async () => {
    await writeFile(join(cardsDir, "alpha.md"), "version 1");

    const store = new CardStore(cardsDir, archiveDir);
    const cache = new EmbeddingCache(tmpDir, "mock-model");
    const provider = mockProvider();

    await embedCards(store, provider, cache);
    const oldVector = cache.get("alpha")!.vector;

    // Mutate content
    await writeFile(join(cardsDir, "alpha.md"), "version 2");
    store.invalidateCache();

    const result = await embedCards(store, provider, cache);
    expect(result.embedded).toBe(1);
    expect(cache.get("alpha")!.vector).not.toEqual(oldVector);
  });

  it("removes stale cache entries for deleted cards", async () => {
    await writeFile(join(cardsDir, "alpha.md"), "content");
    await writeFile(join(cardsDir, "beta.md"), "content");

    const store = new CardStore(cardsDir, archiveDir);
    const cache = new EmbeddingCache(tmpDir, "mock-model");
    const provider = mockProvider();

    await embedCards(store, provider, cache);
    expect(cache.slugs()).toContain("beta");

    // Delete beta
    const { rm: rmFile } = await import("node:fs/promises");
    await rmFile(join(cardsDir, "beta.md"));
    store.invalidateCache();

    const result = await embedCards(store, provider, cache);
    expect(result.removed).toBe(1);
    expect(cache.get("beta")).toBeUndefined();
  });
});
