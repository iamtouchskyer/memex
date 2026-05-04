import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { CardStore } from "./store.js";

/**
 * Generic embedding provider interface.
 * Implementations convert text arrays into vector arrays.
 */
export interface EmbeddingProvider {
  readonly model: string;
  embed(texts: string[]): Promise<number[][]>;
}

// --- Provider type ---

export type EmbeddingProviderType = "openai" | "azure" | "local" | "ollama";

/**
 * OpenAI embedding provider using text-embedding-3-small (1536 dims).
 * Uses native Node `https` module — no external dependencies.
 */
const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const DEFAULT_AZURE_EMBEDDING_DEPLOYMENT = "text-embedding-3-large";

interface OpenAIEmbeddingProviderOptions {
  extraHeaders?: Record<string, string>;
  providerName?: string;
}

function embeddingsPath(basePath: string): string {
  if (!basePath || basePath === "/") return "/v1/embeddings";
  if (basePath.endsWith("/v1")) return `${basePath}/embeddings`;
  return `${basePath}/v1/embeddings`;
}

function resolveHomePath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) {
    return join(homedir(), path.slice(2));
  }
  return path;
}

function readKeyFile(path: string): string | undefined {
  try {
    const key = readFileSync(resolveHomePath(path), "utf-8").trim();
    return key || undefined;
  } catch {
    return undefined;
  }
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private apiKey: string;
  private baseHostname: string;
  private basePath: string;
  private requestPath: string;
  private basePort: number | undefined;
  private useHttp: boolean;
  private extraHeaders: Record<string, string>;

  constructor(apiKey?: string, model?: string, baseUrl?: string, options: OpenAIEmbeddingProviderOptions = {}) {
    const key = apiKey ?? process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error(
        `${options.providerName ?? "OpenAI"} API key required: pass to constructor or set OPENAI_API_KEY`
      );
    }
    this.apiKey = key;
    this.model = model ?? DEFAULT_EMBEDDING_MODEL;

    const url = baseUrl ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com";
    const parsed = new URL(url);
    this.baseHostname = parsed.hostname;
    this.basePath = parsed.pathname.replace(/\/$/, "");
    this.requestPath = embeddingsPath(this.basePath);
    this.basePort = parsed.port ? Number(parsed.port) : undefined;
    this.useHttp = parsed.protocol === "http:";
    this.extraHeaders = options.extraHeaders ?? {};
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const results: number[][] = [];
    // OpenAI allows up to 2048 inputs per request
    const batchSize = 2048;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      const vectors = await this.requestEmbeddings(batch);
      results.push(...vectors);
    }

    return results;
  }

  private requestEmbeddings(texts: string[]): Promise<number[][]> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: this.model,
        input: texts,
      });

      const reqFn = this.useHttp ? httpRequest : httpsRequest;
      const reqOptions: Record<string, unknown> = {
        hostname: this.baseHostname,
        path: this.requestPath,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          ...this.extraHeaders,
          "Content-Length": Buffer.byteLength(body),
        },
      };
      if (this.basePort) reqOptions.port = this.basePort;

      const req = reqFn(
        reqOptions as any,
        (res: any) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                reject(
                  new Error(`OpenAI API error: ${parsed.error.message}`)
                );
                return;
              }
              // Sort by index to guarantee order matches input
              const sorted = (
                parsed.data as Array<{ index: number; embedding: number[] }>
              ).sort((a, b) => a.index - b.index);
              resolve(sorted.map((d) => d.embedding));
            } catch (e) {
              reject(new Error(`Failed to parse OpenAI response: ${e}`));
            }
          });
        }
      );

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}

function normalizeAzureEndpoint(endpoint: string): string {
  const parsed = new URL(endpoint);
  const path = parsed.pathname.replace(/\/$/, "");
  if (!path || path === "/") {
    parsed.pathname = "/openai/v1";
  } else if (path.endsWith("/openai")) {
    parsed.pathname = `${path}/v1`;
  } else {
    parsed.pathname = path;
  }
  parsed.search = "";
  return parsed.toString();
}

function resolveAzureApiKey(apiKey?: string, apiKeyPath?: string): string | undefined {
  if (apiKey) return apiKey;
  if (apiKeyPath) return readKeyFile(apiKeyPath);

  return process.env.AZURE_OPENAI_API_KEY
    ?? process.env.MEMEX_AZURE_OPENAI_API_KEY
    ?? readKeyFile(
      process.env.AZURE_OPENAI_API_KEY_FILE
        ?? process.env.MEMEX_AZURE_OPENAI_API_KEY_FILE
        ?? join(homedir(), ".azure_api_key")
    );
}

function resolveAzureEndpoint(endpoint?: string): string {
  const value = endpoint
    ?? process.env.AZURE_OPENAI_ENDPOINT
    ?? process.env.MEMEX_AZURE_OPENAI_ENDPOINT;
  if (!value) {
    throw new Error(
      "Azure OpenAI endpoint required: set azureOpenaiEndpoint or AZURE_OPENAI_ENDPOINT"
    );
  }
  return normalizeAzureEndpoint(value);
}

export interface AzureOpenAIEmbeddingProviderOptions {
  apiKey?: string;
  apiKeyPath?: string;
  endpoint?: string;
  deployment?: string;
}

export class AzureOpenAIEmbeddingProvider extends OpenAIEmbeddingProvider {
  constructor(options: AzureOpenAIEmbeddingProviderOptions = {}) {
    const apiKey = resolveAzureApiKey(options.apiKey, options.apiKeyPath);
    if (!apiKey) {
      throw new Error(
        "Azure OpenAI API key required: set AZURE_OPENAI_API_KEY or create ~/.azure_api_key"
      );
    }

    const deployment = options.deployment
      ?? process.env.AZURE_OPENAI_EMBEDDING_DEPLOYMENT
      ?? process.env.MEMEX_AZURE_OPENAI_DEPLOYMENT
      ?? DEFAULT_AZURE_EMBEDDING_DEPLOYMENT;

    super(apiKey, deployment, resolveAzureEndpoint(options.endpoint), {
      extraHeaders: { "api-key": apiKey },
      providerName: "Azure OpenAI",
    });
  }
}

// --- Local Embedding Provider (node-llama-cpp + GGUF) ---

const DEFAULT_LOCAL_MODEL =
  "hf:ggml-org/embeddinggemma-300m-qat-q8_0-GGUF/embeddinggemma-300m-qat-Q8_0.gguf";

/** Handle returned by node-llama-cpp's model.createEmbeddingContext(). */
interface LlamaEmbeddingContext {
  getEmbeddingFor(text: string): Promise<{ vector: readonly number[] }>;
}

/**
 * Normalize a vector to unit length.
 * Replaces NaN/Infinity with 0 and returns a zero vector when magnitude is negligible.
 */
function normalizeVector(vec: number[]): number[] {
  const sanitized = vec.map((v) => (Number.isFinite(v) ? v : 0));
  const magnitude = Math.sqrt(sanitized.reduce((sum, v) => sum + v * v, 0));
  if (magnitude < 1e-10) return new Array<number>(sanitized.length).fill(0);
  return sanitized.map((v) => v / magnitude);
}

/**
 * Check whether node-llama-cpp is available (installed and importable).
 */
export async function isNodeLlamaCppAvailable(): Promise<boolean> {
  try {
    await import("node-llama-cpp");
    return true;
  } catch {
    return false;
  }
}

/**
 * Estimate the maximum safe character length for a given token context size.
 *
 * Uses a conservative ratio of ~1.5 characters per token to safely handle
 * CJK text (Chinese/Japanese/Korean), where tokenization is much denser
 * (~2 chars/token) compared to English (~4 chars/token).
 * Leaves a 10% margin to account for tokenizer variability.
 */
function estimateMaxChars(contextTokens: number): number {
  const CHARS_PER_TOKEN = 1.5; // conservative: safe for CJK (~2) and English (~4)
  const SAFETY_MARGIN = 0.9;
  return Math.floor(contextTokens * CHARS_PER_TOKEN * SAFETY_MARGIN);
}

/**
 * Split text into chunks that fit within a character limit.
 * Splits on paragraph boundaries (double newlines) when possible,
 * falling back to hard truncation for very long paragraphs.
 */
export function chunkText(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  const paragraphs = text.split(/\n\n+/);
  let current = "";

  for (const para of paragraphs) {
    if (para.length > maxChars) {
      // Paragraph itself is too long — flush current, then hard-chunk the paragraph
      if (current.length > 0) {
        chunks.push(current.trim());
        current = "";
      }
      for (let i = 0; i < para.length; i += maxChars) {
        chunks.push(para.slice(i, i + maxChars).trim());
      }
    } else if (current.length + para.length + 2 > maxChars) {
      // Adding this paragraph would exceed the limit — flush current
      if (current.length > 0) {
        chunks.push(current.trim());
      }
      current = para;
    } else {
      current = current.length > 0 ? current + "\n\n" + para : para;
    }
  }

  if (current.length > 0) {
    chunks.push(current.trim());
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Average multiple vectors element-wise and normalize the result.
 */
function averageVectors(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  if (vectors.length === 1) return vectors[0];

  const dim = vectors[0].length;
  const avg = new Array<number>(dim).fill(0);
  for (const vec of vectors) {
    for (let i = 0; i < dim; i++) {
      avg[i] += vec[i];
    }
  }
  for (let i = 0; i < dim; i++) {
    avg[i] /= vectors.length;
  }
  return normalizeVector(avg);
}

/**
 * Local embedding provider using node-llama-cpp with a GGUF model.
 *
 * - Lazily loads node-llama-cpp and the model on first embed() call
 * - Downloads the model automatically on first use (~328 MB)
 * - Produces 768-dimensional vectors (with embeddinggemma-300m)
 * - Requires node-llama-cpp as an optional dependency
 * - Automatically chunks long texts that exceed the model's context window
 */
export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private modelPath: string;
  private context: LlamaEmbeddingContext | null = null;
  private initPromise: Promise<LlamaEmbeddingContext> | null = null;
  /** Maximum safe character length for a single embedding call. */
  private _maxChars: number = estimateMaxChars(2048); // conservative default

  constructor(modelPath?: string) {
    this.modelPath = modelPath ?? DEFAULT_LOCAL_MODEL;
    // Use a cache-friendly model name for the EmbeddingCache file key
    this.model = this.modelPath.includes("/")
      ? this.modelPath.split("/").pop()!.replace(/\.gguf$/i, "")
      : this.modelPath;
  }

  /** Expose maxChars for testing and diagnostics. */
  get maxChars(): number {
    return this._maxChars;
  }

  private async ensureContext(): Promise<LlamaEmbeddingContext> {
    if (this.context) return this.context;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const { getLlama, resolveModelFile, LlamaLogLevel } = await import(
          "node-llama-cpp"
        );

        const resolved = await resolveModelFile(this.modelPath);
        const llama = await getLlama({ logLevel: LlamaLogLevel.error });
        const model = await llama.loadModel({ modelPath: resolved });

        // Use the model's actual training context size to compute safe limits
        const trainCtx = model.trainContextSize;
        if (trainCtx && trainCtx > 0) {
          this._maxChars = estimateMaxChars(trainCtx);
        }

        const ctx = await model.createEmbeddingContext();
        this.context = ctx as LlamaEmbeddingContext;
        return this.context;
      } catch (err) {
        // Allow retry on next call by clearing the promise
        this.initPromise = null;
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes("Cannot find package")) {
          throw new Error(
            "node-llama-cpp is not installed. Install it with: npm install node-llama-cpp"
          );
        }
        throw new Error(`Failed to initialize local embedding model: ${message}`);
      }
    })();

    return this.initPromise;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const ctx = await this.ensureContext();
    const results: number[][] = [];

    for (const text of texts) {
      const chunks = chunkText(text, this._maxChars);

      if (chunks.length === 1) {
        // Single chunk — embed directly
        const embedding = await ctx.getEmbeddingFor(chunks[0]);
        results.push(normalizeVector(Array.from(embedding.vector)));
      } else {
        // Multiple chunks — embed each and average
        const chunkVectors: number[][] = [];
        for (const chunk of chunks) {
          const embedding = await ctx.getEmbeddingFor(chunk);
          chunkVectors.push(normalizeVector(Array.from(embedding.vector)));
        }
        results.push(averageVectors(chunkVectors));
      }
    }

    return results;
  }
}

// --- Ollama Embedding Provider ---

/**
 * Ollama embedding provider — calls a local Ollama server's /api/embed endpoint.
 *
 * Lightweight alternative that requires only a running Ollama instance.
 * No native dependencies needed.
 */
export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private baseUrl: string;

  constructor(options?: { model?: string; baseUrl?: string }) {
    this.model = options?.model ?? process.env.MEMEX_OLLAMA_MODEL ?? "nomic-embed-text";
    this.baseUrl =
      options?.baseUrl ??
      process.env.MEMEX_OLLAMA_BASE_URL ??
      process.env.OLLAMA_HOST ??
      "http://localhost:11434";
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    // Ollama /api/embed supports batch input
    const body = JSON.stringify({
      model: this.model,
      input: texts,
    });

    const url = new URL("/api/embed", this.baseUrl);
    const isHttps = url.protocol === "https:";
    const requestFn = isHttps ? httpsRequest : httpRequest;

    return new Promise((resolve, reject) => {
      const req = requestFn(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 11434),
          path: url.pathname,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk: Buffer) => {
            data += chunk.toString();
          });
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.error) {
                reject(new Error(`Ollama API error: ${parsed.error}`));
                return;
              }
              if (!parsed.embeddings || !Array.isArray(parsed.embeddings)) {
                reject(
                  new Error(
                    "Unexpected Ollama response: missing embeddings array"
                  )
                );
                return;
              }
              resolve(
                (parsed.embeddings as number[][]).map((v) =>
                  normalizeVector(v)
                )
              );
            } catch (e) {
              reject(new Error(`Failed to parse Ollama response: ${e}`));
            }
          });
        }
      );

      req.on("error", (err) => {
        reject(
          new Error(
            `Cannot connect to Ollama at ${this.baseUrl}: ${err.message}. ` +
              "Is Ollama running? Start it with: ollama serve"
          )
        );
      });
      req.write(body);
      req.end();
    });
  }
}

// --- Provider factory ---

export interface CreateProviderOptions {
  type?: EmbeddingProviderType;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  openaiModel?: string;
  azureOpenaiApiKey?: string;
  azureOpenaiApiKeyPath?: string;
  azureOpenaiEndpoint?: string;
  azureOpenaiDeployment?: string;
  localModelPath?: string;
  ollamaModel?: string;
  ollamaBaseUrl?: string;
}

/**
 * Create an embedding provider based on the requested type.
 *
 * Resolution order when type is not specified:
 * 1. If OPENAI_API_KEY is available → OpenAI
 * 2. If Azure OpenAI endpoint + key are available → Azure OpenAI
 * 3. If node-llama-cpp is installed → Local
 * 4. Error with helpful message
 */
export async function createEmbeddingProvider(
  options: CreateProviderOptions = {}
): Promise<EmbeddingProvider> {
  const requestedType =
    options.type ??
    (process.env.MEMEX_EMBEDDING_PROVIDER as EmbeddingProviderType | undefined);

  // Explicit provider requested
  if (requestedType === "openai") {
    return new OpenAIEmbeddingProvider(options.openaiApiKey, options.openaiModel, options.openaiBaseUrl);
  }
  if (requestedType === "azure") {
    return new AzureOpenAIEmbeddingProvider({
      apiKey: options.azureOpenaiApiKey,
      apiKeyPath: options.azureOpenaiApiKeyPath,
      endpoint: options.azureOpenaiEndpoint,
      deployment: options.azureOpenaiDeployment ?? options.openaiModel,
    });
  }
  if (requestedType === "local") {
    return new LocalEmbeddingProvider(options.localModelPath);
  }
  if (requestedType === "ollama") {
    return new OllamaEmbeddingProvider({
      model: options.ollamaModel,
      baseUrl: options.ollamaBaseUrl,
    });
  }

  // Auto-detect: try OpenAI first, then Azure OpenAI, then local.
  const apiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (apiKey) {
    return new OpenAIEmbeddingProvider(apiKey, options.openaiModel, options.openaiBaseUrl);
  }

  const azureEndpoint = options.azureOpenaiEndpoint
    ?? process.env.AZURE_OPENAI_ENDPOINT
    ?? process.env.MEMEX_AZURE_OPENAI_ENDPOINT;
  if (azureEndpoint) {
    const azureApiKey = resolveAzureApiKey(options.azureOpenaiApiKey, options.azureOpenaiApiKeyPath);
    if (azureApiKey) {
      return new AzureOpenAIEmbeddingProvider({
        apiKey: azureApiKey,
        endpoint: azureEndpoint,
        deployment: options.azureOpenaiDeployment ?? options.openaiModel,
      });
    }
  }

  // Try local (node-llama-cpp)
  if (await isNodeLlamaCppAvailable()) {
    return new LocalEmbeddingProvider(options.localModelPath);
  }

  // No provider available — provide helpful error
  throw new Error(
    "No embedding provider available.\n" +
      "Options:\n" +
      "  1. Set OPENAI_API_KEY for OpenAI embeddings\n" +
      "  2. Set AZURE_OPENAI_ENDPOINT plus AZURE_OPENAI_API_KEY or ~/.azure_api_key for Azure OpenAI embeddings\n" +
      "  3. Install node-llama-cpp for local embeddings: npm install node-llama-cpp\n" +
      "  4. Run Ollama locally and set MEMEX_EMBEDDING_PROVIDER=ollama\n" +
      "Configure via .memexrc { \"embeddingProvider\": \"local\" } or MEMEX_EMBEDDING_PROVIDER env var."
  );
}

// --- Cache ---

interface CacheEntry {
  vector: number[];
  contentHash: string;
  updatedAt: string;
}

interface CacheData {
  model: string;
  version: number;
  entries: Record<string, CacheEntry>;
}

/**
 * File-backed embedding cache.
 * Stores vectors keyed by card slug with content-hash invalidation.
 */
export class EmbeddingCache {
  private data: CacheData;
  private filePath: string;

  constructor(
    private memexHome: string,
    private cacheModel: string
  ) {
    this.filePath = join(
      memexHome,
      ".memex",
      "embeddings",
      `${cacheModel}.json`
    );
    this.data = { model: cacheModel, version: 1, entries: {} };
  }

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as CacheData;
      if (parsed.model === this.cacheModel && parsed.version === 1) {
        this.data = parsed;
      }
    } catch {
      // File missing or corrupt — start fresh
    }
  }

  async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2), "utf-8");
  }

  get(slug: string): CacheEntry | undefined {
    return this.data.entries[slug];
  }

  set(slug: string, vector: number[], contentHash: string): void {
    this.data.entries[slug] = {
      vector,
      contentHash,
      updatedAt: new Date().toISOString(),
    };
  }

  remove(slug: string): void {
    delete this.data.entries[slug];
  }

  needsUpdate(slug: string, currentHash: string): boolean {
    const entry = this.data.entries[slug];
    return !entry || entry.contentHash !== currentHash;
  }

  /** Returns all cached slugs (for stale-entry detection). */
  slugs(): string[] {
    return Object.keys(this.data.entries);
  }
}

// --- Utilities ---

/** Compute SHA-256 hex digest of a string. */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Cosine similarity between two vectors of equal length. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// --- Orchestrator ---

export interface EmbedCardsResult {
  embedded: number;
  removed: number;
  total: number;
}

/**
 * Scan all cards, embed new/changed ones, remove stale cache entries.
 */
export async function embedCards(
  store: CardStore,
  provider: EmbeddingProvider,
  cache: EmbeddingCache
): Promise<EmbedCardsResult> {
  const cards = await store.scanAll();
  const currentSlugs = new Set<string>();
  const toEmbed: Array<{ slug: string; hash: string; text: string }> = [];

  // Identify new/changed cards
  for (const card of cards) {
    currentSlugs.add(card.slug);
    const raw = await store.readCard(card.slug);
    const hash = contentHash(raw);

    if (cache.needsUpdate(card.slug, hash)) {
      toEmbed.push({ slug: card.slug, hash, text: raw });
    }
  }

  // Batch-embed changed cards
  if (toEmbed.length > 0) {
    const vectors = await provider.embed(toEmbed.map((c) => c.text));
    for (let i = 0; i < toEmbed.length; i++) {
      cache.set(toEmbed[i].slug, vectors[i], toEmbed[i].hash);
    }
  }

  // Remove stale entries (cards that no longer exist)
  let removed = 0;
  for (const slug of cache.slugs()) {
    if (!currentSlugs.has(slug)) {
      cache.remove(slug);
      removed++;
    }
  }

  return {
    embedded: toEmbed.length,
    removed,
    total: cards.length,
  };
}
