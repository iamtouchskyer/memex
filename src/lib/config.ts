import { readFile, readdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { EmbeddingProviderType } from "./embeddings.js";

export interface MemexConfig {
  nestedSlugs: boolean;
  searchDirs?: string[];
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  embeddingModel?: string;
  /** Embedding provider: "openai" | "azure" | "local" | "ollama". Auto-detected if omitted. */
  embeddingProvider?: EmbeddingProviderType;
  /** Azure OpenAI endpoint, e.g. https://resource.openai.azure.com/openai/v1/ */
  azureOpenaiEndpoint?: string;
  /** Azure OpenAI API key. Prefer env/key file for local secrets. */
  azureOpenaiApiKey?: string;
  /** Path to Azure OpenAI API key file (default: ~/.azure_api_key). */
  azureOpenaiApiKeyPath?: string;
  /** Ollama model name (default: "nomic-embed-text"). */
  ollamaModel?: string;
  /** Ollama base URL (default: "http://localhost:11434"). */
  ollamaBaseUrl?: string;
  /** Local GGUF model path or HuggingFace URI for node-llama-cpp. */
  localModelPath?: string;
  /** Extra directories (relative to MEMEX_HOME) whose .md files count as valid link targets in doctor. */
  extraLinkDirs?: string[];
  /** Experimental feature flags. */
  experimental?: {
    /** Enable A-MEM-inspired agentic memory skill workflow. Default: false. */
    agenticMemory?: boolean;
  };
}

/**
 * Read config from $MEMEX_HOME/.memexrc
 * Returns default config if file doesn't exist or is invalid.
 */
export async function readConfig(memexHome: string): Promise<MemexConfig> {
  const configPath = join(memexHome, ".memexrc");

  try {
    const content = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(content);

    return {
      nestedSlugs: parsed.nestedSlugs === true,
      searchDirs: Array.isArray(parsed.searchDirs) ? parsed.searchDirs : undefined,
      openaiApiKey: typeof parsed.openaiApiKey === "string" ? parsed.openaiApiKey : undefined,
      openaiBaseUrl: typeof parsed.openaiBaseUrl === "string" ? parsed.openaiBaseUrl : undefined,
      embeddingModel: typeof parsed.embeddingModel === "string" ? parsed.embeddingModel : undefined,
      embeddingProvider: isValidProvider(parsed.embeddingProvider) ? parsed.embeddingProvider : undefined,
      azureOpenaiEndpoint: typeof parsed.azureOpenaiEndpoint === "string" ? parsed.azureOpenaiEndpoint : undefined,
      azureOpenaiApiKey: typeof parsed.azureOpenaiApiKey === "string" ? parsed.azureOpenaiApiKey : undefined,
      azureOpenaiApiKeyPath: typeof parsed.azureOpenaiApiKeyPath === "string" ? parsed.azureOpenaiApiKeyPath : undefined,
      ollamaModel: typeof parsed.ollamaModel === "string" ? parsed.ollamaModel : undefined,
      ollamaBaseUrl: typeof parsed.ollamaBaseUrl === "string" ? parsed.ollamaBaseUrl : undefined,
      localModelPath: typeof parsed.localModelPath === "string" ? parsed.localModelPath : undefined,
      extraLinkDirs: Array.isArray(parsed.extraLinkDirs) ? parsed.extraLinkDirs : undefined,
      experimental: parseExperimental(parsed.experimental),
    };
  } catch {
    // File doesn't exist or invalid JSON - return defaults
    return {
      nestedSlugs: false,
    };
  }
}

function isValidProvider(value: unknown): value is EmbeddingProviderType {
  return value === "openai" || value === "azure" || value === "local" || value === "ollama";
}

function parseExperimental(value: unknown): MemexConfig["experimental"] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const agenticMemory = obj.agenticMemory === true ? true : undefined;
  if (agenticMemory === undefined) {
    return undefined;
  }
  return { agenticMemory };
}

/**
 * Walk up from `startDir` looking for a `.memexrc` file.
 * Returns the directory containing the file, or undefined if not found.
 * Stops at the filesystem root.
 */
export async function findMemexrcUp(startDir: string): Promise<string | undefined> {
  let dir = startDir;
  for (;;) {
    try {
      await access(join(dir, ".memexrc"));
      return dir;
    } catch {
      // not found, keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return undefined;
}

/**
 * Resolve the memex home directory.
 * Precedence: MEMEX_HOME env var > walk-up .memexrc discovery > ~/.memex fallback.
 */
export async function resolveMemexHome(): Promise<string> {
  if (process.env.MEMEX_HOME) {
    return process.env.MEMEX_HOME;
  }
  const found = await findMemexrcUp(process.cwd());
  if (found) {
    return found;
  }
  return join(homedir(), ".memex");
}

/**
 * Warn to stderr if the cards directory doesn't exist or is empty.
 */
export async function warnIfEmptyCards(home: string): Promise<void> {
  const cardsDir = join(home, "cards");
  try {
    const entries = await readdir(cardsDir);
    if (entries.length === 0) {
      process.stderr.write(`Warning: cards directory is empty (${cardsDir})\n`);
    }
  } catch {
    process.stderr.write(`Warning: cards directory not found (${cardsDir})\n`);
  }
}
