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
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: true, searchDirs: ["projects", "notes"] }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: true, searchDirs: ["projects", "notes"] });
  });

  it("treats non-array searchDirs as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: false, searchDirs: "projects" }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false, searchDirs: undefined });
  });

  it("treats missing searchDirs field as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: false }));
    const config = await readConfig(tmpDir);
    expect(config).toEqual({ nestedSlugs: false });
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

  it("reads embeddingProvider: azure from config file", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ embeddingProvider: "azure" }));
    const config = await readConfig(tmpDir);
    expect(config.embeddingProvider).toBe("azure");
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

  it("reads Azure OpenAI config from config file", async () => {
    await writeFile(
      join(tmpDir, ".memexrc"),
      JSON.stringify({
        azureOpenaiEndpoint: "https://example.openai.azure.com/openai/v1/",
        azureOpenaiApiKey: "azure-test-key",
        azureOpenaiApiKeyPath: "~/.azure_api_key",
        embeddingModel: "text-embedding-3-large",
      })
    );
    const config = await readConfig(tmpDir);
    expect(config.azureOpenaiEndpoint).toBe("https://example.openai.azure.com/openai/v1/");
    expect(config.azureOpenaiApiKey).toBe("azure-test-key");
    expect(config.azureOpenaiApiKeyPath).toBe("~/.azure_api_key");
    expect(config.embeddingModel).toBe("text-embedding-3-large");
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
        azureOpenaiEndpoint: "https://example.openai.azure.com/openai/v1/",
        azureOpenaiApiKeyPath: "~/.azure_api_key",
      })
    );
    const config = await readConfig(tmpDir);
    expect(config.embeddingProvider).toBe("ollama");
    expect(config.ollamaModel).toBe("nomic-embed-text");
    expect(config.ollamaBaseUrl).toBe("http://localhost:11434");
    expect(config.localModelPath).toBe("hf:some/model");
    expect(config.openaiApiKey).toBe("sk-test");
    expect(config.azureOpenaiEndpoint).toBe("https://example.openai.azure.com/openai/v1/");
    expect(config.azureOpenaiApiKeyPath).toBe("~/.azure_api_key");
  });

  // --- experimental.agenticMemory config ---

  it("reads experimental.agenticMemory: true", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ experimental: { agenticMemory: true } }));
    const config = await readConfig(tmpDir);
    expect(config.experimental).toEqual({ agenticMemory: true });
  });

  it("treats experimental.agenticMemory: false as disabled", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ experimental: { agenticMemory: false } }));
    const config = await readConfig(tmpDir);
    expect(config.experimental).toBeUndefined();
  });

  it("treats missing experimental as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ nestedSlugs: false }));
    const config = await readConfig(tmpDir);
    expect(config.experimental).toBeUndefined();
  });

  it("treats experimental: null as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ experimental: null }));
    const config = await readConfig(tmpDir);
    expect(config.experimental).toBeUndefined();
  });

  it("treats experimental: string as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ experimental: "yes" }));
    const config = await readConfig(tmpDir);
    expect(config.experimental).toBeUndefined();
  });

  it("treats experimental.agenticMemory: string as disabled", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ experimental: { agenticMemory: "true" } }));
    const config = await readConfig(tmpDir);
    expect(config.experimental).toBeUndefined();
  });

  it("treats experimental.agenticMemory: 1 as disabled", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ experimental: { agenticMemory: 1 } }));
    const config = await readConfig(tmpDir);
    expect(config.experimental).toBeUndefined();
  });

  it("treats experimental: {} (empty object) as undefined", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ experimental: {} }));
    const config = await readConfig(tmpDir);
    expect(config.experimental).toBeUndefined();
  });

  it("treats experimental.agenticMemory: null as disabled", async () => {
    await writeFile(join(tmpDir, ".memexrc"), JSON.stringify({ experimental: { agenticMemory: null } }));
    const config = await readConfig(tmpDir);
    expect(config.experimental).toBeUndefined();
  });

  it("preserves existing config fields alongside experimental", async () => {
    await writeFile(
      join(tmpDir, ".memexrc"),
      JSON.stringify({ nestedSlugs: true, embeddingProvider: "openai", experimental: { agenticMemory: true } })
    );
    const config = await readConfig(tmpDir);
    expect(config.nestedSlugs).toBe(true);
    expect(config.embeddingProvider).toBe("openai");
    expect(config.experimental).toEqual({ agenticMemory: true });
  });
});
