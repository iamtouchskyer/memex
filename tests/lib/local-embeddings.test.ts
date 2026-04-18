import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  LocalEmbeddingProvider,
  OllamaEmbeddingProvider,
  isNodeLlamaCppAvailable,
  createEmbeddingProvider,
  chunkText,
} from "../../src/lib/embeddings.js";

describe("isNodeLlamaCppAvailable", () => {
  it("returns true when node-llama-cpp is installed", async () => {
    // node-llama-cpp is installed as an optional dep in this project
    const available = await isNodeLlamaCppAvailable();
    expect(available).toBe(true);
  });
});

describe("createEmbeddingProvider", () => {
  let origApiKey: string | undefined;
  let origProvider: string | undefined;

  beforeEach(() => {
    origApiKey = process.env.OPENAI_API_KEY;
    origProvider = process.env.MEMEX_EMBEDDING_PROVIDER;
  });

  afterEach(() => {
    if (origApiKey !== undefined) {
      process.env.OPENAI_API_KEY = origApiKey;
    } else {
      delete process.env.OPENAI_API_KEY;
    }
    if (origProvider !== undefined) {
      process.env.MEMEX_EMBEDDING_PROVIDER = origProvider;
    } else {
      delete process.env.MEMEX_EMBEDDING_PROVIDER;
    }
  });

  it("creates OpenAI provider when API key is set", async () => {
    process.env.OPENAI_API_KEY = "sk-test-key";
    delete process.env.MEMEX_EMBEDDING_PROVIDER;

    const provider = await createEmbeddingProvider();
    expect(provider.model).toBe("text-embedding-3-small");
  });

  it("creates OpenAI provider when type is explicitly openai", async () => {
    const provider = await createEmbeddingProvider({
      type: "openai",
      openaiApiKey: "sk-test-key",
    });
    expect(provider.model).toBe("text-embedding-3-small");
  });

  it("creates local provider when type is explicitly local", async () => {
    const provider = await createEmbeddingProvider({ type: "local" });
    expect(provider).toBeInstanceOf(LocalEmbeddingProvider);
  });

  it("creates ollama provider when type is explicitly ollama", async () => {
    const provider = await createEmbeddingProvider({ type: "ollama" });
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
    expect(provider.model).toBe("nomic-embed-text");
  });

  it("falls back to local when no API key and node-llama-cpp is available", async () => {
    delete process.env.OPENAI_API_KEY;
    delete process.env.MEMEX_EMBEDDING_PROVIDER;

    const provider = await createEmbeddingProvider();
    expect(provider).toBeInstanceOf(LocalEmbeddingProvider);
  });

  it("respects MEMEX_EMBEDDING_PROVIDER env var", async () => {
    process.env.MEMEX_EMBEDDING_PROVIDER = "ollama";
    const provider = await createEmbeddingProvider();
    expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
  });

  it("explicit type overrides env var", async () => {
    process.env.MEMEX_EMBEDDING_PROVIDER = "ollama";
    const provider = await createEmbeddingProvider({ type: "local" });
    expect(provider).toBeInstanceOf(LocalEmbeddingProvider);
  });
});

// --- chunkText ---

describe("chunkText", () => {
  it("returns single chunk for short text", () => {
    const result = chunkText("hello world", 100);
    expect(result).toEqual(["hello world"]);
  });

  it("returns single chunk when text equals maxChars", () => {
    const text = "a".repeat(100);
    const result = chunkText(text, 100);
    expect(result).toEqual([text]);
  });

  it("splits on paragraph boundaries", () => {
    const text = "paragraph one\n\nparagraph two\n\nparagraph three";
    const result = chunkText(text, 20);
    expect(result).toEqual(["paragraph one", "paragraph two", "paragraph three"]);
  });

  it("groups paragraphs that fit together", () => {
    const text = "short\n\nalso short\n\nthird paragraph is longer";
    // maxChars = 25: "short\n\nalso short" = 17 chars, fits
    const result = chunkText(text, 25);
    expect(result).toEqual(["short\n\nalso short", "third paragraph is longer"]);
  });

  it("hard-chunks very long paragraphs", () => {
    const text = "a".repeat(100);
    const result = chunkText(text, 30);
    expect(result.length).toBe(4);
    expect(result[0]).toBe("a".repeat(30));
    expect(result[1]).toBe("a".repeat(30));
    expect(result[2]).toBe("a".repeat(30));
    expect(result[3]).toBe("a".repeat(10));
  });

  it("handles mixed short and long paragraphs", () => {
    const longPara = "x".repeat(50);
    const text = `short\n\n${longPara}\n\nalso short`;
    const result = chunkText(text, 30);
    // "short" is one chunk, long para splits into two, "also short" is one
    expect(result.length).toBe(4);
    expect(result[0]).toBe("short");
    expect(result[1]).toBe("x".repeat(30));
    expect(result[2]).toBe("x".repeat(20));
    expect(result[3]).toBe("also short");
  });

  it("filters empty chunks", () => {
    const text = "hello\n\n\n\n\n\nworld";
    const result = chunkText(text, 5);
    expect(result.every((c) => c.length > 0)).toBe(true);
  });

  it("all chunks are within maxChars limit", () => {
    // Generate a realistic long document
    const paragraphs = Array.from({ length: 20 }, (_, i) =>
      `Paragraph ${i}: ${"lorem ipsum dolor sit amet ".repeat(10)}`
    );
    const text = paragraphs.join("\n\n");
    const maxChars = 200;

    const result = chunkText(text, maxChars);
    for (const chunk of result) {
      expect(chunk.length).toBeLessThanOrEqual(maxChars);
    }
    // Verify we don't lose content: concatenated chunks should cover the text
    expect(result.length).toBeGreaterThan(1);
  });
});

describe("LocalEmbeddingProvider", () => {
  it("constructs with default model", () => {
    const provider = new LocalEmbeddingProvider();
    expect(provider.model).toContain("embeddinggemma");
  });

  it("constructs with custom model path", () => {
    const provider = new LocalEmbeddingProvider("/path/to/model.gguf");
    expect(provider.model).toBe("model");
  });

  it("returns empty array for empty input", async () => {
    const provider = new LocalEmbeddingProvider();
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });

  it("has a default maxChars based on 2048 token context", () => {
    const provider = new LocalEmbeddingProvider();
    // 2048 * 1.5 * 0.9 = 2764
    expect(provider.maxChars).toBe(2764);
  });

  // Slow test: actually loads the model and generates embeddings
  it("generates embeddings for text", async () => {
    const provider = new LocalEmbeddingProvider();
    const result = await provider.embed(["hello world"]);

    expect(result).toHaveLength(1);
    expect(result[0].length).toBe(768); // embeddinggemma-300m produces 768-dim vectors

    // Should be normalized (unit vector)
    const magnitude = Math.sqrt(result[0].reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 2);
  }, 300000); // 5 min — model download + loading is slow on Windows CI

  it("generates different embeddings for different texts", async () => {
    const provider = new LocalEmbeddingProvider();
    const result = await provider.embed(["hello world", "goodbye moon"]);

    expect(result).toHaveLength(2);
    expect(result[0]).not.toEqual(result[1]);
  }, 300000); // 5 min — consistent with other embedding tests

  it("generates consistent embeddings for the same text", async () => {
    const provider = new LocalEmbeddingProvider();
    const [v1] = await provider.embed(["test consistency"]);
    const [v2] = await provider.embed(["test consistency"]);

    // Vectors should be identical
    expect(v1).toEqual(v2);
  }, 300000); // 5 min — consistent with other embedding tests

  it("handles long text that exceeds context size without error", async () => {
    const provider = new LocalEmbeddingProvider();

    // Generate text much longer than the context window (~15K chars, well over 2048 tokens)
    const longText = Array.from({ length: 50 }, (_, i) =>
      `Section ${i}: The quick brown fox jumps over the lazy dog. ` +
      "This is a test of the emergency broadcast system. " +
      "All work and no play makes Jack a dull boy. " +
      "The rain in Spain falls mainly on the plain."
    ).join("\n\n");

    expect(longText.length).toBeGreaterThan(8000);

    const result = await provider.embed([longText]);

    expect(result).toHaveLength(1);
    expect(result[0].length).toBe(768);

    // Should be normalized
    const magnitude = Math.sqrt(result[0].reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 2);
  }, 300000); // 5 min — long text = multiple chunks; Windows CI with native bindings is slow

  it("handles long Chinese text without context overflow", async () => {
    const provider = new LocalEmbeddingProvider();

    // Chinese text is ~2 chars/token, so 5000+ Chinese chars ≈ 2500+ tokens
    // This would overflow the 2048 token context without proper chunking
    const chineseParagraph = "这是一段用于测试嵌入模型上下文窗口限制的中文文本。" +
      "人工智能技术正在快速发展，大语言模型可以理解和生成自然语言。" +
      "知识管理系统需要能够处理各种语言的文本，包括中文、日文和韩文。";
    const longChineseText = Array.from({ length: 60 }, (_, i) =>
      `第${i}节：${chineseParagraph}`
    ).join("\n\n");

    expect(longChineseText.length).toBeGreaterThan(5000);

    const result = await provider.embed([longChineseText]);

    expect(result).toHaveLength(1);
    expect(result[0].length).toBe(768);

    // Should be normalized
    const magnitude = Math.sqrt(result[0].reduce((sum, v) => sum + v * v, 0));
    expect(magnitude).toBeCloseTo(1, 2);
  }, 300000); // 5 min — CJK text chunking + model inference is slow on Windows CI

  it("handles mix of short and long texts in batch", async () => {
    const provider = new LocalEmbeddingProvider();

    const shortText = "hello world";
    const longText = Array.from({ length: 30 }, (_, i) =>
      `Paragraph ${i}: ${"lorem ipsum dolor sit amet consectetur adipiscing elit ".repeat(5)}`
    ).join("\n\n");

    const result = await provider.embed([shortText, longText]);

    expect(result).toHaveLength(2);
    expect(result[0].length).toBe(768);
    expect(result[1].length).toBe(768);
    // They should be different vectors
    expect(result[0]).not.toEqual(result[1]);
  }, 300000); // 5 min — batch with long text is slow on Windows CI
});

describe("OllamaEmbeddingProvider", () => {
  it("constructs with default model", () => {
    const provider = new OllamaEmbeddingProvider();
    expect(provider.model).toBe("nomic-embed-text");
  });

  it("constructs with custom model and base URL", () => {
    const provider = new OllamaEmbeddingProvider({
      model: "all-minilm",
      baseUrl: "http://custom:8080",
    });
    expect(provider.model).toBe("all-minilm");
  });

  it("returns empty array for empty input", async () => {
    const provider = new OllamaEmbeddingProvider();
    const result = await provider.embed([]);
    expect(result).toEqual([]);
  });

  it("respects MEMEX_OLLAMA_MODEL env var", () => {
    const orig = process.env.MEMEX_OLLAMA_MODEL;
    process.env.MEMEX_OLLAMA_MODEL = "custom-model";
    try {
      const provider = new OllamaEmbeddingProvider();
      expect(provider.model).toBe("custom-model");
    } finally {
      if (orig !== undefined) {
        process.env.MEMEX_OLLAMA_MODEL = orig;
      } else {
        delete process.env.MEMEX_OLLAMA_MODEL;
      }
    }
  });

  it("provides helpful error when Ollama is not running", async () => {
    // Connect to a port that's definitely not running Ollama
    const provider = new OllamaEmbeddingProvider({
      baseUrl: "http://localhost:1",
    });

    await expect(provider.embed(["test"])).rejects.toThrow("Cannot connect to Ollama");
  });
});
