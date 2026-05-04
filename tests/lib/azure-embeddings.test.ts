import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  AzureOpenAIEmbeddingProvider,
  createEmbeddingProvider,
} from "../../src/lib/embeddings.js";

describe("AzureOpenAIEmbeddingProvider", () => {
  let tmpDir: string;
  let originalEndpoint: string | undefined;
  let originalApiKey: string | undefined;
  let originalApiKeyFile: string | undefined;
  let originalDeployment: string | undefined;
  let originalProvider: string | undefined;
  let originalOpenAIKey: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "memex-azure-embed-"));
    originalEndpoint = process.env.AZURE_OPENAI_ENDPOINT;
    originalApiKey = process.env.AZURE_OPENAI_API_KEY;
    originalApiKeyFile = process.env.AZURE_OPENAI_API_KEY_FILE;
    originalDeployment = process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;
    originalProvider = process.env.MEMEX_EMBEDDING_PROVIDER;
    originalOpenAIKey = process.env.OPENAI_API_KEY;

    delete process.env.AZURE_OPENAI_ENDPOINT;
    delete process.env.AZURE_OPENAI_API_KEY;
    delete process.env.AZURE_OPENAI_API_KEY_FILE;
    delete process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT;
    delete process.env.MEMEX_EMBEDDING_PROVIDER;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(async () => {
    restoreEnv("AZURE_OPENAI_ENDPOINT", originalEndpoint);
    restoreEnv("AZURE_OPENAI_API_KEY", originalApiKey);
    restoreEnv("AZURE_OPENAI_API_KEY_FILE", originalApiKeyFile);
    restoreEnv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", originalDeployment);
    restoreEnv("MEMEX_EMBEDDING_PROVIDER", originalProvider);
    restoreEnv("OPENAI_API_KEY", originalOpenAIKey);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("constructs with explicit endpoint and API key", () => {
    const provider = new AzureOpenAIEmbeddingProvider({
      endpoint: "https://example.openai.azure.com/openai/v1/",
      apiKey: "azure-test-key",
      deployment: "my-embedding-deployment",
    });

    expect(provider).toBeInstanceOf(AzureOpenAIEmbeddingProvider);
    expect(provider.model).toBe("my-embedding-deployment");
  });

  it("reads API key from a configured key file", async () => {
    const keyFile = join(tmpDir, "azure.key");
    await writeFile(keyFile, "azure-test-key\n");

    const provider = new AzureOpenAIEmbeddingProvider({
      endpoint: "https://example.openai.azure.com/openai/v1/",
      apiKeyPath: keyFile,
    });

    expect(provider.model).toBe("text-embedding-3-large");
  });

  it("returns empty embeddings for empty input without making a request", async () => {
    const provider = new AzureOpenAIEmbeddingProvider({
      endpoint: "https://example.openai.azure.com/openai/v1/",
      apiKey: "azure-test-key",
    });

    await expect(provider.embed([])).resolves.toEqual([]);
  });

  it("calls the Azure OpenAI v1 embeddings endpoint", async () => {
    const seen: { url?: string; auth?: string; apiKey?: string; body?: unknown } = {};
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk: Buffer) => {
        body += chunk.toString();
      });
      req.on("end", () => {
        seen.url = req.url;
        seen.auth = req.headers.authorization;
        seen.apiKey = req.headers["api-key"] as string | undefined;
        seen.body = JSON.parse(body);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] }));
      });
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;

    try {
      const provider = new AzureOpenAIEmbeddingProvider({
        endpoint: `http://127.0.0.1:${address.port}/openai/v1/`,
        apiKey: "azure-test-key",
        deployment: "embedding-deployment",
      });

      const vectors = await provider.embed(["hello"]);

      expect(vectors).toEqual([[0.1, 0.2, 0.3]]);
      expect(seen.url).toBe("/openai/v1/embeddings");
      expect(seen.auth).toBe("Bearer azure-test-key");
      expect(seen.apiKey).toBe("azure-test-key");
      expect(seen.body).toEqual({ model: "embedding-deployment", input: ["hello"] });
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    }
  });
  it("creates Azure provider when type is explicitly azure", async () => {
    const provider = await createEmbeddingProvider({
      type: "azure",
      azureOpenaiEndpoint: "https://example.openai.azure.com/openai/v1/",
      azureOpenaiApiKey: "azure-test-key",
    });

    expect(provider).toBeInstanceOf(AzureOpenAIEmbeddingProvider);
  });

  it("auto-detects Azure provider when endpoint and key are configured", async () => {
    process.env.AZURE_OPENAI_ENDPOINT = "https://example.openai.azure.com/openai/v1/";
    process.env.AZURE_OPENAI_API_KEY = "azure-test-key";

    const provider = await createEmbeddingProvider();
    expect(provider).toBeInstanceOf(AzureOpenAIEmbeddingProvider);
  });
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}
