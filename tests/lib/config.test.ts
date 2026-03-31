import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfig } from "../../src/lib/config.js";

describe("readConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-config-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns default config when file does not exist", async () => {
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
  });

  it("returns default config when file is invalid JSON", async () => {
    await writeFile(join(tmpDir, ".memexrc"), "invalid json{");
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
  });

  it("reads nestedSlugs: true from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: true }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: true });
  });

  it("reads nestedSlugs: false from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: false }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
  });

  it("treats non-boolean nestedSlugs as false", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: "yes" }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
  });

  it("treats missing nestedSlugs field as false", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ otherField: "value" }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
  });

  it("reads searchDirs from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ searchDirs: ["archive", "notes"] }));
    const config = await readConfig(tmpDir);
    expect(config.searchDirs).toEqual(["archive", "notes"]);
  });

  it("treats non-array searchDirs as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ searchDirs: "archive" }));
    const config = await readConfig(tmpDir);
    expect(config.searchDirs).toBeUndefined();
  });

  it("treats missing searchDirs field as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: false }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
  });

  // --- embeddingModel ---

  it("reads embeddingModel from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ embeddingModel: "text-embedding-3-large" }));
    const config = await readConfig(tmpDir);
    expect(config.embeddingModel).toBe("text-embedding-3-large");
  });

  it("treats non-string embeddingModel as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ embeddingModel: 42 }));
    const config = await readConfig(tmpDir);
    expect(config.embeddingModel).toBeUndefined();
  });

  // --- semanticWeight ---

  it("reads semanticWeight from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ semanticWeight: 0.5 }));
    const config = await readConfig(tmpDir);
    expect(config.semanticWeight).toBe(0.5);
  });

  it("accepts semanticWeight: 0", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ semanticWeight: 0 }));
    const config = await readConfig(tmpDir);
    expect(config.semanticWeight).toBe(0);
  });

  it("accepts semanticWeight: 1", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ semanticWeight: 1 }));
    const config = await readConfig(tmpDir);
    expect(config.semanticWeight).toBe(1);
  });

  it("treats semanticWeight < 0 as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ semanticWeight: -0.1 }));
    const config = await readConfig(tmpDir);
    expect(config.semanticWeight).toBeUndefined();
  });

  it("treats semanticWeight > 1 as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ semanticWeight: 1.1 }));
    const config = await readConfig(tmpDir);
    expect(config.semanticWeight).toBeUndefined();
  });

  it("treats non-number semanticWeight as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ semanticWeight: "0.7" }));
    const config = await readConfig(tmpDir);
    expect(config.semanticWeight).toBeUndefined();
  });

  // --- embeddingProvider config ---

  it("reads embeddingProvider: local from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ embeddingProvider: "local" }));
    const config = await readConfig(tmpDir);
    expect(config.embeddingProvider).toBe("local");
  });

  it("reads embeddingProvider: openai from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ embeddingProvider: "openai" }));
    const config = await readConfig(tmpDir);
    expect(config.embeddingProvider).toBe("openai");
  });

  it("reads embeddingProvider: ollama from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ embeddingProvider: "ollama" }));
    const config = await readConfig(tmpDir);
    expect(config.embeddingProvider).toBe("ollama");
  });

  it("treats invalid embeddingProvider as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ embeddingProvider: "invalid" }));
    const config = await readConfig(tmpDir);
    expect(config.embeddingProvider).toBeUndefined();
  });

  it("treats non-string embeddingProvider as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ embeddingProvider: 42 }));
    const config = await readConfig(tmpDir);
    expect(config.embeddingProvider).toBeUndefined();
  });

  it("reads ollamaModel from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ ollamaModel: "all-minilm" }));
    const config = await readConfig(tmpDir);
    expect(config.ollamaModel).toBe("all-minilm");
  });

  it("reads ollamaBaseUrl from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ ollamaBaseUrl: "http://myhost:11434" }));
    const config = await readConfig(tmpDir);
    expect(config.ollamaBaseUrl).toBe("http://myhost:11434");
  });

  it("reads localModelPath from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ localModelPath: "/path/to/model.gguf" }));
    const config = await readConfig(tmpDir);
    expect(config.localModelPath).toBe("/path/to/model.gguf");
  });

  it("reads full embedding config together", async () => {
    await writeFile(
      join(tmpDir, ".memexrc"),
      JSON.stringify({
        nestedSlugs: false,
        embeddingProvider: "ollama",
        ollamaModel: "nomic-embed-text",
        ollamaBaseUrl: "http://localhost:11434",
        localModelPath: "hf:some/model",
        openaiApiKey: "sk-test",
        semanticWeight: 0.8,
      })
    );
    const config = await readConfig(tmpDir);
    expect(config.embeddingProvider).toBe("ollama");
    expect(config.ollamaModel).toBe("nomic-embed-text");
    expect(config.ollamaBaseUrl).toBe("http://localhost:11434");
    expect(config.localModelPath).toBe("hf:some/model");
    expect(config.openaiApiKey).toBe("sk-test");
    expect(config.semanticWeight).toBe(0.8);
  });
});