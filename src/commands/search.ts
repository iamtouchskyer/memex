import { CardStore } from "../lib/store.js";
import { parseFrontmatter, extractLinks } from "../lib/parser.js";
import { formatCardList, formatSearchResult, formatCompactSearchResult } from "../lib/formatter.js";
import { MemexConfig } from "../lib/config.js";
import {
  EmbeddingCache,
  embedCards,
  cosineSimilarity,
  createEmbeddingProvider,
  type EmbeddingProvider,
} from "../lib/embeddings.js";
import {
  tokenizeQuery,
  buildSearchableFields,
  scoreCard,
  sortScoredMatches,
  type ScoredMatch,
} from "../lib/scoring.js";
import {
  createDecisionProvider,
  rerankWithSystemOne,
  type DecisionProvider,
  type RerankSearchResult,
} from "../lib/systemone.js";
import { join } from "node:path";
import { formatWarnings, prepareMemexInput, type SensitiveInputResult } from "../lib/sensitive-input.js";

const DEFAULT_LIMIT = 10;

export interface ManifestFilter {
  category?: string;
  tag?: string;
  author?: string;
  since?: string;   // YYYY-MM-DD
  before?: string;  // YYYY-MM-DD
}

interface SearchOptions {
  limit?: number;
  all?: boolean;
  config?: MemexConfig;
  memexHome?: string;
  semantic?: boolean;
  compact?: boolean;
  /** Override embedding provider (for testing). */
  _embeddingProvider?: EmbeddingProvider;
  /** Rerank and filter candidates via System-1 decision model. */
  rerank?: boolean;
  /** Override decision provider (for testing). */
  _decisionProvider?: DecisionProvider;
  filter?: ManifestFilter;
  /** When true with no query, list cards instead of showing guidance. */
  list?: boolean;
}

interface SearchResult {
  output: string;
  exitCode: number;
  totalCount?: number;
  warnings?: string[];
  rerank?: RerankSearchResult;
}

export async function searchCommand(store: CardStore, query: string | undefined, options: SearchOptions = {}): Promise<SearchResult> {
  const safety: SensitiveInputResult = query ? prepareMemexInput(query, "query") : { ok: true, text: query ?? "", warnings: [] };
  if (!safety.ok) return { output: safety.error ?? "Sensitive input rejected.", exitCode: 1 };
  query = safety.text;

  // Gather all stores to search
  const storesToSearch: Array<{ store: CardStore; dirPrefix: string }> = [
    { store, dirPrefix: "cards" }
  ];

  // Add additional search directories if --all is set
  if (options.all && options.config?.searchDirs && options.config.searchDirs.length > 0 && options.memexHome) {
    const archiveDir = join(options.memexHome, "archive");
    for (const searchDir of options.config.searchDirs) {
      const fullPath = join(options.memexHome, searchDir);
      const additionalStore = new CardStore(fullPath, archiveDir, store["nestedSlugs"]);
      const dirName = searchDir.split("/").pop() || searchDir;
      storesToSearch.push({ store: additionalStore, dirPrefix: dirName });
    }
  }

  // Only prefix slugs if we're actually searching multiple directories
  const shouldPrefix = storesToSearch.length > 1;

  // Collect all cards from all stores
  let allCards: Array<{ slug: string; store: CardStore; dirPrefix: string }> = [];
  for (const { store: s, dirPrefix } of storesToSearch) {
    const cards = await s.scanAll();
    for (const card of cards) {
      allCards.push({ slug: card.slug, store: s, dirPrefix });
    }
  }

  if (allCards.length === 0) return withWarnings({ output: "", exitCode: 0 }, safety.warnings);

  // Apply manifest pre-filter
  if (options.filter) {
    allCards = await filterByManifest(allCards, options.filter);
    if (allCards.length === 0) return withWarnings({ output: "", exitCode: 0 }, safety.warnings);
  }

  // Semantic search path
  if (query && options.semantic) {
    return withWarnings(await semanticSearch(query, allCards, shouldPrefix, options), safety.warnings);
  }

  // No query: guidance or list
  if (!query) {
    // Show guidance only when no query, no filter, and no list flag
    if (!options.list && !options.filter) {
      const guidance = [
        "No query provided. To search your knowledge base:",
        "- memex read index — view your knowledge map",
        "- memex search <keyword> — keyword search",
        "- memex search --semantic <query> — natural language search",
        "Use --list to browse all cards.",
      ].join("\n");
      return withWarnings({ output: guidance, exitCode: 0, totalCount: allCards.length }, safety.warnings);
    }
    const rawLimit = options.limit ?? DEFAULT_LIMIT;
    const limit = rawLimit < 0 ? DEFAULT_LIMIT : rawLimit;
    const toProcess = limit > 0 ? allCards.slice(0, limit) : [];
    const items = await Promise.all(
      toProcess.map(async (c) => {
        const raw = await c.store.readCard(c.slug);
        const { data } = parseFrontmatter(raw);
        const prefixedSlug = shouldPrefix ? `${c.dirPrefix}/${c.slug}` : c.slug;
        return { slug: prefixedSlug, title: String(data.title || c.slug) };
      })
    );
    let output = formatCardList(items);
    if (allCards.length > toProcess.length) {
      output += `\n\n(${toProcess.length} of ${allCards.length} cards shown. Use \`memex search <keyword>\` to narrow results.)`;
    }
    return withWarnings({ output, exitCode: 0, totalCount: allCards.length }, safety.warnings);
  }

  // With query: keyword search body only (strip frontmatter before matching)
  return withWarnings(await keywordSearch(query, allCards, shouldPrefix, options), safety.warnings);
}

function withWarnings(result: SearchResult, warnings: string[]): SearchResult {
  if (warnings.length === 0) return result;
  const warningText = formatWarnings(warnings);
  return {
    ...result,
    warnings,
    output: result.output ? `${warningText}\n\n${result.output}` : warningText,
  };
}

// --- Manifest pre-filter ---

async function filterByManifest(
  allCards: Array<{ slug: string; store: CardStore; dirPrefix: string }>,
  filter: ManifestFilter,
): Promise<Array<{ slug: string; store: CardStore; dirPrefix: string }>> {
  const results: Array<{ slug: string; store: CardStore; dirPrefix: string }> = [];

  for (const card of allCards) {
    const raw = await card.store.readCard(card.slug);
    const { data } = parseFrontmatter(raw);

    if (!matchesFilter(data, filter)) continue;
    results.push(card);
  }

  return results;
}

function toDateString(val: unknown): string {
  if (val instanceof Date) return val.toISOString().slice(0, 10);
  if (typeof val === "string") return val.slice(0, 10);
  return "";
}

function matchesFilter(data: Record<string, unknown>, filter: ManifestFilter): boolean {
  // Category: exact match (case-insensitive)
  if (filter.category) {
    const val = data.category;
    if (typeof val !== "string" || val.toLowerCase() !== filter.category.toLowerCase()) {
      return false;
    }
  }

  // Tag: check if filter value appears in tags (array or comma-separated string)
  if (filter.tag) {
    const needle = filter.tag.toLowerCase();
    const raw = data.tags ?? data.tag;
    if (raw == null) return false;

    let tags: string[];
    if (Array.isArray(raw)) {
      tags = raw.map((t) => String(t).trim().toLowerCase());
    } else {
      tags = String(raw).split(",").map((t) => t.trim().toLowerCase());
    }

    if (!tags.includes(needle)) return false;
  }

  // Author: match against 'author' or 'source' field (case-insensitive)
  if (filter.author) {
    const needle = filter.author.toLowerCase();
    const author = data.author;
    const source = data.source;
    const authorMatch = typeof author === "string" && author.toLowerCase() === needle;
    const sourceMatch = typeof source === "string" && source.toLowerCase() === needle;
    if (!authorMatch && !sourceMatch) return false;
  }

  // Since: card's 'created' OR 'modified' date >= filter date
  if (filter.since) {
    const created = toDateString(data.created);
    const modified = toDateString(data.modified);
    if (!(created >= filter.since || modified >= filter.since)) return false;
  }

  // Before: card's 'created' OR 'modified' date < filter date
  if (filter.before) {
    const created = toDateString(data.created);
    const modified = toDateString(data.modified);
    const createdOk = created !== "" && created < filter.before;
    const modifiedOk = modified !== "" && modified < filter.before;
    if (!createdOk && !modifiedOk) return false;
  }

  return true;
}

// --- Keyword search (ranked lexical retrieval) ---

async function keywordSearch(
  query: string,
  allCards: Array<{ slug: string; store: CardStore; dirPrefix: string }>,
  shouldPrefix: boolean,
  options: SearchOptions,
): Promise<SearchResult> {
  const rawLimit = options.limit ?? DEFAULT_LIMIT;
  const limit = rawLimit < 0 ? DEFAULT_LIMIT : rawLimit;

  const { tokens, originalTokens } = tokenizeQuery(query);
  if (tokens.length === 0) return { output: "", exitCode: 0 };

  const scored: ScoredMatch[] = [];

  for (const card of allCards) {
    const raw = await card.store.readCard(card.slug);
    const { data, content } = parseFrontmatter(raw);
    const links = extractLinks(content);
    const fields = buildSearchableFields(card.slug, data, content, links);

    const match = scoreCard(tokens, originalTokens, fields);
    if (!match) continue;

    // Override slug with prefixed version if needed
    if (shouldPrefix) {
      match.slug = `${card.dirPrefix}/${card.slug}`;
    }

    scored.push(match);
  }

  if (scored.length === 0) return { output: "", exitCode: 0 };

  sortScoredMatches(scored);

  const useRerank =
    options.rerank === true ||
    options.config?.experimental?.systemOneMemory === true ||
    Boolean(options._decisionProvider);

  let topCards = scored.slice(0, limit);
  let rerankData: RerankSearchResult | undefined;

  if (useRerank && limit > 0) {
    try {
      const provider =
        options._decisionProvider ??
        createDecisionProvider({
          apiKey: options.config?.decisionApiKey,
          apiKeyPath: options.config?.decisionApiKeyPath,
          baseUrl: options.config?.decisionBaseUrl,
          model: options.config?.decisionModel,
        });

      const poolSize = Math.min(scored.length, Math.max(limit * 3, 18));
      const poolMatches = scored.slice(0, poolSize);
      const candidateInputs: Array<{
        slug: string;
        title: string;
        created?: string;
        content: string;
        lexicalScore: number;
      }> = [];

      for (const m of poolMatches) {
        const originalSlug = shouldPrefix ? m.slug.split("/").slice(1).join("/") : m.slug;
        const card = allCards.find(
          (c) => c.slug === originalSlug || `${c.dirPrefix}/${c.slug}` === m.slug,
        );
        if (!card) continue;
        const raw = await card.store.readCard(card.slug);
        const { data, content } = parseFrontmatter(raw);
        candidateInputs.push({
          slug: m.slug,
          title: String(data.title || card.slug),
          created: toDateString(data.created),
          content,
          lexicalScore: m.score,
        });
      }

      rerankData = await rerankWithSystemOne(provider, query, candidateInputs, {
        maxKeep: limit,
      });

      const matchBySlug = new Map(poolMatches.map((m) => [m.slug, m]));
      topCards = rerankData.selected
        .map((s) => matchBySlug.get(s.slug))
        .filter((m): m is ScoredMatch => Boolean(m));
    } catch {
      // Fallback to lexical topCards if decision provider fails
    }
  }

  const results: string[] = [];
  for (const matched of topCards) {
    // Re-read to get full content for display
    const originalSlug = shouldPrefix ? matched.slug.split("/").slice(1).join("/") : matched.slug;
    const card = allCards.find(c => c.slug === originalSlug || `${c.dirPrefix}/${c.slug}` === matched.slug);
    if (!card) continue;

    const raw = await card.store.readCard(card.slug);
    const { data, content } = parseFrontmatter(raw);
    const links = extractLinks(content);
    const paragraphs = content.trim().split(/\n\n+/);
    const firstParagraph = paragraphs[0]?.trim() || "";

    const showMatchLine = matched.matchLine && !firstParagraph.includes(matched.matchLine) ? matched.matchLine : null;

    // Only show matchedFields when it's a true metadata-only match (no body/heading matchLine found by scorer)
    // Don't show it when matchLine was just suppressed because it's in firstParagraph
    const showMatchedFields = matched.matchLine === "" ? matched.matchedFields : undefined;

    const item = {
      slug: matched.slug,
      title: String(data.title || card.slug),
      firstParagraph,
      matchLine: showMatchLine,
      links,
      matchedFields: showMatchedFields,
    };

    results.push(
      options.compact
        ? formatCompactSearchResult(item)
        : formatSearchResult(item)
    );
  }

  return {
    output: results.join(options.compact ? "\n" : "\n\n"),
    exitCode: 0,
    totalCount: scored.length,
    rerank: rerankData,
  };
}

// --- Semantic search ---

async function semanticSearch(
  query: string,
  allCards: Array<{ slug: string; store: CardStore; dirPrefix: string }>,
  shouldPrefix: boolean,
  options: SearchOptions,
): Promise<SearchResult> {
  const rawLimit = options.limit ?? DEFAULT_LIMIT;
  const limit = rawLimit < 0 ? DEFAULT_LIMIT : rawLimit;
  if (limit === 0) return { output: "", exitCode: 0 };

  // Resolve embedding provider
  let provider: EmbeddingProvider;
  if (options._embeddingProvider) {
    provider = options._embeddingProvider;
  } else {
    try {
      provider = await createEmbeddingProvider({
        type: options.config?.embeddingProvider,
        openaiApiKey: options.config?.openaiApiKey,
        openaiBaseUrl: options.config?.openaiBaseUrl,
        openaiModel: options.config?.embeddingModel,
        azureOpenaiApiKey: options.config?.azureOpenaiApiKey,
        azureOpenaiApiKeyPath: options.config?.azureOpenaiApiKeyPath,
        azureOpenaiEndpoint: options.config?.azureOpenaiEndpoint,
        azureOpenaiDeployment: options.config?.embeddingModel,
        localModelPath: options.config?.localModelPath,
        ollamaModel: options.config?.ollamaModel,
        ollamaBaseUrl: options.config?.ollamaBaseUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: message, exitCode: 1 };
    }
  }

  // Build / refresh embedding cache
  const memexHome = options.memexHome ?? "";
  const cache = new EmbeddingCache(memexHome, provider.model);
  await cache.load();

  // embedCards works on a single store; iterate unique stores
  for (const { store: s } of groupByStore(allCards)) {
    await embedCards(s, provider, cache);
  }
  await cache.save();

  // Embed the query
  const [queryVector] = await provider.embed([query]);

  // Run keyword matching for hybrid scoring (returns 0-1 normalized scores)
  const keywordScores = await computeKeywordScores(query, allCards);

  // Compute scores for all cards
  type ScoredCard = { slug: string; store: CardStore; dirPrefix: string; score: number };
  const scored: ScoredCard[] = [];

  for (const card of allCards) {
    const entry = cache.get(card.slug);
    if (!entry) continue;

    const semScore = cosineSimilarity(queryVector, entry.vector);
    const kwScore = keywordScores.get(card.slug) ?? 0;

    // Hybrid scoring: semantic + additive keyword boost
    // Keyword match always helps, never hurts
    const finalScore = semScore + 0.3 * kwScore;

    scored.push({ slug: card.slug, store: card.store, dirPrefix: card.dirPrefix, score: finalScore });
  }

  // Sort descending by score, take top N
  scored.sort((a, b) => b.score - a.score);
  const topCards = scored.slice(0, limit);

  const results: string[] = [];
  for (const card of topCards) {
    const raw = await card.store.readCard(card.slug);
    const { data, content } = parseFrontmatter(raw);
    const links = extractLinks(content);
    const paragraphs = content.trim().split(/\n\n+/);
    const firstParagraph = paragraphs[0]?.trim() || "";

    const prefixedSlug = shouldPrefix ? `${card.dirPrefix}/${card.slug}` : card.slug;

    const item = {
      slug: prefixedSlug,
      title: String(data.title || card.slug),
      firstParagraph,
      matchLine: null,
      links,
    };

    results.push(
      options.compact
        ? formatCompactSearchResult(item, card.score)
        : formatSearchResult(item)
    );
  }

  return { output: results.join(options.compact ? "\n" : "\n\n"), exitCode: 0, totalCount: scored.length };
}

/** Compute keyword coverage scores per card slug (ranked OR, not AND boolean). */
async function computeKeywordScores(
  query: string,
  allCards: Array<{ slug: string; store: CardStore; dirPrefix: string }>,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const { tokens, originalTokens } = tokenizeQuery(query);
  if (tokens.length === 0) return scores;

  for (const card of allCards) {
    const raw = await card.store.readCard(card.slug);
    const { data, content } = parseFrontmatter(raw);
    const links = extractLinks(content);
    const fields = buildSearchableFields(card.slug, data, content, links);

    const match = scoreCard(tokens, originalTokens, fields);
    if (match) {
      scores.set(card.slug, match.score);
    }
  }

  return scores;
}

/** Deduplicate stores from allCards list. */
function groupByStore(
  allCards: Array<{ slug: string; store: CardStore; dirPrefix: string }>,
): Array<{ store: CardStore; dirPrefix: string }> {
  const seen = new Set<CardStore>();
  const result: Array<{ store: CardStore; dirPrefix: string }> = [];
  for (const card of allCards) {
    if (!seen.has(card.store)) {
      seen.add(card.store);
      result.push({ store: card.store, dirPrefix: card.dirPrefix });
    }
  }
  return result;
}
