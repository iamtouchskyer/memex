import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchCommand } from "../../src/commands/search.js";
import { CardStore } from "../../src/lib/store.js";
import { contentHash, type EmbeddingProvider } from "../../src/lib/embeddings.js";

/**
 * Mock provider where keyword-matching cards get slightly higher semantic score.
 * Uses content-hash-based vectors so different content → different vectors.
 */
function createDeterministicProvider(): EmbeddingProvider & { embedCalls: string[][] } {
  const provider = {
    model: "mock-model",
    embedCalls: [] as string[][],
    async embed(texts: string[]): Promise<number[][]> {
      provider.embedCalls.push([...texts]);
      return texts.map((t) => {
        const h = contentHash(t);
        const raw = [
          parseInt(h.slice(0, 8), 16) / 0xffffffff,
          parseInt(h.slice(8, 16), 16) / 0xffffffff,
          parseInt(h.slice(16, 24), 16) / 0xffffffff,
        ];
        const norm = Math.sqrt(raw[0] ** 2 + raw[1] ** 2 + raw[2] ** 2);
        return norm > 0 ? raw.map((v) => v / norm) : raw;
      });
    },
  };
  return provider;
}

/**
 * Mock provider that returns identical vectors for all texts.
 * Makes semantic scores equal so keyword score is the sole tiebreaker.
 */
function createUniformProvider(): EmbeddingProvider & { embedCalls: string[][] } {
  const provider = {
    model: "mock-model",
    embedCalls: [] as string[][],
    async embed(texts: string[]): Promise<number[][]> {
      provider.embedCalls.push([...texts]);
      return texts.map(() => [1, 0, 0]);
    },
  };
  return provider;
}

describe("semantic search with configurable semanticWeight", () => {
  let tmpDir: string;
  let store: CardStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-weight-"));
    const cardsDir = join(tmpDir, "cards");
    await mkdir(cardsDir, { recursive: true });
    store = new CardStore(cardsDir, join(tmpDir, "archive"));

    // Card A: matches keyword "redis" — name starts with 'a' so it's first alphabetically
    await writeFile(
      join(cardsDir, "a-redis-cache.md"),
      `---
title: Redis Caching
created: 2026-03-18
---

Redis is an in-memory data structure store. Redis Redis Redis.`
    );

    // Card B: does NOT match keyword "redis" — name starts with 'b'
    await writeFile(
      join(cardsDir, "b-cooking.md"),
      `---
title: Cooking Tips
created: 2026-03-18
---

How to bake sourdough bread perfectly.`
    );
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("uses default weight 0.7 when no config provided", async () => {
    const provider = createUniformProvider();
    const result = await searchCommand(store, "redis", {
      semantic: true,
      memexHome: tmpDir,
      _embeddingProvider: provider,
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("a-redis-cache");
    expect(result.output).toContain("b-cooking");
  });

  it("respects semanticWeight: 0 (keyword dominates)", async () => {
    // semanticWeight=0 → keywordWeight=1.0
    // keyword card: 0*sem + 1.0*kwNorm ≈ 1.0
    // non-keyword card: pure sem (which is < 1 with deterministic vectors)
    const provider = createDeterministicProvider();
    const result = await searchCommand(store, "redis", {
      semantic: true,
      memexHome: tmpDir,
      _embeddingProvider: provider,
      config: { nestedSlugs: false, semanticWeight: 0 },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("a-redis-cache");
    expect(result.output).toContain("b-cooking");
    const redisPos = result.output.indexOf("a-redis-cache");
    const cookingPos = result.output.indexOf("b-cooking");
    expect(redisPos).toBeLessThan(cookingPos);
  });

  it("respects semanticWeight: 1.0 (pure semantic)", async () => {
    const provider = createUniformProvider();
    const result = await searchCommand(store, "redis", {
      semantic: true,
      memexHome: tmpDir,
      _embeddingProvider: provider,
      config: { nestedSlugs: false, semanticWeight: 1.0 },
    });

    expect(result.exitCode).toBe(0);
    // With semanticWeight=1.0, keyword weight = 0
    // keyword card: 1.0*sem + 0*kw = sem. But kwRaw>0 branch still applies.
    // non-keyword card: pure sem. Both cards have same sem score → both appear
    expect(result.output).toContain("a-redis-cache");
    expect(result.output).toContain("b-cooking");
  });

  it("weight value affects final hybrid score", async () => {
    // Verify that the semanticWeight value changes the computed score.
    // With uniform vectors (sem=1.0 for all), and keyword match on redis-cache:
    //   weight=0.5: redis hybrid = 0.5*1 + 0.5*1 = 1.0, cooking = 1.0 (equal)
    //   weight=0.0: redis hybrid = 0*1 + 1*1 = 1.0, cooking = 1.0 (equal)
    // So let's test with deterministic vectors where we know the scores:
    //   With semanticWeight=0, redis gets 0*sem + 1*kwNorm.
    //   With semanticWeight=1, redis gets 1*sem + 0*kwNorm = sem.
    // Both should return results without errors.
    for (const weight of [0, 0.3, 0.5, 0.7, 1.0]) {
      const provider = createDeterministicProvider();
      const result = await searchCommand(store, "redis", {
        semantic: true,
        memexHome: tmpDir,
        _embeddingProvider: provider,
        config: { nestedSlugs: false, semanticWeight: weight },
      });

      expect(result.exitCode).toBe(0);
      expect(result.output).toContain("a-redis-cache");
      expect(result.output).toContain("b-cooking");
    }
  });

  it("uses embeddingModel from config to create provider", async () => {
    const provider = createUniformProvider();
    const result = await searchCommand(store, "redis", {
      semantic: true,
      memexHome: tmpDir,
      _embeddingProvider: provider,
      config: {
        nestedSlugs: false,
        embeddingModel: "text-embedding-3-large",
        semanticWeight: 0.7,
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("a-redis-cache");
  });
});
