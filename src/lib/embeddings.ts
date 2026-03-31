import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { request as httpRequest } from "node:http";
import { join, dirname } from "node:path";
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

export type EmbeddingProviderType = "openai" | "local" | "ollama";

/** Default embedding model when none is configured. */
export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";

/** Maximum number of retry attempts for transient API errors. */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff. */
const BASE_DELAY_MS = 1000;

/**
 * Sleep for the specified number of milliseconds.
 * Extracted as a function so tests can verify retry behavior.
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Determine whether an HTTP status code is retryable.
 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * OpenAI embedding provider.
 * Model is configurable (defaults to text-embedding-3-small).
 * Uses native Node `https` module — no external dependencies.
 * Retries on 429 (rate limit) and 5xx errors with exponential backoff.
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model: string;
  private apiKey: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey ?? process.env.OPENAI_API_KEY ?? "";
    this.model = model ?? DEFAULT_EMBEDDING_MODEL;

    if (!this.apiKey) {
      throw new Error("OpenAI API key is required. Set openaiApiKey in .memexrc or OPENAI_API_KEY env var.");
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.makeRequest(texts);
      } catch (err) {
        const isLastAttempt = attempt === MAX_RETRIES;
        if (isLastAttempt) throw err;

        // Check if error is retryable
        if (err instanceof Error && err.message.includes("status:")) {
          const statusMatch = err.message.match(/status:\s*(\d+)/);
          const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
          
          if (!isRetryableStatus(status)) {
            throw err; // Don't retry non-retryable errors
          }
        } else {
          throw err; // Don't retry non-HTTP errors
        }

        // Calculate backoff delay: BASE_DELAY_MS * 2^(attempt-1)
        const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        await sleep(delayMs);
      }
    }

    // This line should never be reached due to the throw in the last attempt
    throw new Error("Unexpected end of retry loop");
  }

  private async makeRequest(texts: string[]): Promise<number[][]> {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify({
        model: this.model,
        input: texts,
      });

      const req = httpsRequest(
        {
          hostname: "api.openai.com",
          path: "/v1/embeddings",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            Authorization: `Bearer ${this.apiKey}`,
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
              
              if (res.statusCode !== 200) {
                const errorMsg = parsed.error?.message || `HTTP ${res.statusCode}`;
                reject(new Error(`OpenAI API error (status: ${res.statusCode}): ${errorMsg}`));
                return;
              }

              if (!parsed.data || !Array.isArray(parsed.data)) {
                reject(new Error("Invalid OpenAI API response: missing data array"));
                return;
              }

              const vectors = parsed.data.map((item: any) => item.embedding);
              resolve(vectors);
            } catch (e) {
              reject(new Error(`Failed to parse OpenAI response: ${e}`));
            }
          });
        }
      );

      req.on("error", (err) => {
        reject(new Error(`OpenAI API request failed: ${err.message}`));
      });
      req.write(body);
      req.end();
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
  localModelPath?: string;
  ollamaModel?: string;
  ollamaBaseUrl?: string;
}

/**
 * Create an embedding provider based on the requested type.
 *
 * Resolution order when type is not specified:
 * 1. If OPENAI_API_KEY is available → OpenAI
 * 2. If node-llama-cpp is installed → Local
 * 3. Error with helpful message
 */
export async function createEmbeddingProvider(
  options: CreateProviderOptions = {}
): Promise<EmbeddingProvider> {
  const requestedType =
    options.type ??
    (process.env.MEMEX_EMBEDDING_PROVIDER as EmbeddingProviderType | undefined);

  // Explicit provider requested
  if (requestedType === "openai") {
    return new OpenAIEmbeddingProvider(options.openaiApiKey);
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

  // Auto-detect: try OpenAI first, then local, then ollama
  const apiKey = options.openaiApiKey ?? process.env.OPENAI_API_KEY;
  if (apiKey) {
    return new OpenAIEmbeddingProvider(apiKey);
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
      "  2. Install node-llama-cpp for local embeddings: npm install node-llama-cpp\n" +
      "  3. Run Ollama locally and set MEMEX_EMBEDDING_PROVIDER=ollama\n" +
      "Configure via .memexrc { \"embeddingProvider\": \"local\" } or MEMEX_EMBEDDING_PROVIDER env var."
  );
}

// --- Cache ---

interface CacheEntry {
  vector: number[];
  hash: string;
}

interface CacheData {
  model: string;
  version: number;
  entries: Record<string, CacheEntry>;
}

/**
 * File-based cache for embedding vectors.
 * Cache key = content hash; invalidates automatically when content changes.
 */
export class EmbeddingCache {
  private filePath: string;
  private data: CacheData;

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
    await writeFile(this.filePath, JSON.stringify(this.data, null, 2));
  }

  get(slug: string): CacheEntry | null {
    return this.data.entries[slug] || null;
  }

  set(slug: string, vector: number[], contentHash: string): void {
    this.data.entries[slug] = { vector, hash: contentHash };
  }

  isValid(slug: string, contentHash: string): boolean {
    const entry = this.data.entries[slug];
    return entry ? entry.hash === contentHash : false;
  }
}

// --- Embedding generation ---

/**
 * Generate embeddings for all cards in a store and cache them.
 * Only re-embeds cards whose content has changed (based on hash).
 */
export async function embedCards(
  store: CardStore,
  provider: EmbeddingProvider,
  cache: EmbeddingCache
): Promise<void> {
  const cards = await store.scanAll();
  const toEmbed: string[] = [];
  const slugs: string[] = [];

  for (const card of cards) {
    const content = await store.readCard(card.slug);
    const hash = createHash("sha256").update(content).digest("hex");

    if (!cache.isValid(card.slug, hash)) {
      toEmbed.push(content);
      slugs.push(card.slug);
    }
  }

  if (toEmbed.length === 0) return;

  const vectors = await provider.embed(toEmbed);
  for (let i = 0; i < vectors.length; i++) {
    const content = toEmbed[i];
    const hash = createHash("sha256").update(content).digest("hex");
    cache.set(slugs[i], vectors[i], hash);
  }
}

// --- Similarity ---

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 (opposite) and 1 (identical).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    magnitudeA += a[i] * a[i];
    magnitudeB += b[i] * b[i];
  }

  const magnitude = Math.sqrt(magnitudeA * magnitudeB);
  return magnitude === 0 ? 0 : dotProduct / magnitude;
}