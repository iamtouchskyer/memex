import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  OpenAIEmbeddingProvider,
  DEFAULT_EMBEDDING_MODEL,
  sleep,
} from "../../src/lib/embeddings.js";

// --- OpenAIEmbeddingProvider constructor ---

describe("OpenAIEmbeddingProvider constructor", () => {
  const origKey = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (origKey !== undefined) {
      process.env.OPENAI_API_KEY = origKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
  });

  it("uses default model when none specified", () => {
    const provider = new OpenAIEmbeddingProvider("sk-test");
    expect(provider.model).toBe(DEFAULT_EMBEDDING_MODEL);
    expect(provider.model).toBe("text-embedding-3-small");
  });

  it("uses custom model when specified", () => {
    const provider = new OpenAIEmbeddingProvider("sk-test", "text-embedding-3-large");
    expect(provider.model).toBe("text-embedding-3-large");
  });

  it("throws when no API key available", () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIEmbeddingProvider(undefined)).toThrow("OpenAI API key required");
  });

  it("accepts API key from environment", () => {
    process.env.OPENAI_API_KEY = "sk-env-test";
    const provider = new OpenAIEmbeddingProvider(undefined);
    expect(provider.model).toBe(DEFAULT_EMBEDDING_MODEL);
  });
});

// --- sleep utility ---

describe("sleep", () => {
  it("resolves after the specified duration", async () => {
    const start = Date.now();
    await sleep(50);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40); // allow small timing tolerance
  });
});
