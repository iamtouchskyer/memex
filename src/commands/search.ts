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
import { join } from "node:path";

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
  filter?: ManifestFilter;
}

interface SearchResult {
  output: string;
  exitCode: number;
}

export async function searchCommand(store: CardStore, query: string | undefined, options: SearchOptions = {}): Promise<SearchResult> {
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

  if (allCards.length === 0) return { output: "", exitCode: 0 };

  // Apply manifest pre-filter
  if (options.filter) {
    allCards = await filterByManifest(allCards, options.filter);
    if (allCards.length === 0) return { output: "", exitCode: 0 };
  }

  // Semantic search path
  if (query && options.semantic) {
    return semanticSearch(query, allCards, shouldPrefix, options);
  }

  // No query: list all cards
  if (!query) {
    const items = await Promise.all(
      allCards.map(async (c) => {
        const raw = await c.store.readCard(c.slug);
        const { data } = parseFrontmatter(raw);
        const prefixedSlug = shouldPrefix ? `${c.dirPrefix}/${c.slug}` : c.slug;
        return { slug: prefixedSlug, title: String(data.title || c.slug) };
      })
    );
    return { output: formatCardList(items), exitCode: 0 };
  }

  // With query: keyword search body only (strip frontmatter before matching)
  return keywordSearch(query, allCards, shouldPrefix, options);
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

// --- Keyword search ---

async function keywordSearch(
  query: string,
  allCards: Array<{ slug: string; store: CardStore; dirPrefix: string }>,
  shouldPrefix: boolean,
  options: SearchOptions,
): Promise<SearchResult> {
  const rawLimit = options.limit ?? DEFAULT_LIMIT;
  const limit = rawLimit < 0 ? DEFAULT_LIMIT : rawLimit;

  const matchedCards: { slug: string; matchLine: string; matchCount: number; store: CardStore; dirPrefix: string }[] = [];

  // Split query into tokens — ALL tokens must appear (AND logic)
  const tokens = query.split(/\s+/).filter(Boolean);
  const escapedTokens = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  for (const card of allCards) {
    const raw = await card.store.readCard(card.slug);
    const { data, content } = parseFrontmatter(raw);
    const title = String(data.title || card.slug);
    const searchText = title + "\n" + content;

    // Every token must appear (case-insensitive)
    const allMatch = escapedTokens.every((t) => new RegExp(t, "i").test(searchText));
    if (!allMatch) continue;

    // Count total token hits for ranking
    let matchCount = 0;
    for (const t of escapedTokens) {
      const hits = searchText.match(new RegExp(t, "gi"));
      if (hits) matchCount += hits.length;
    }

    // Find first matching line (use first token for the preview line)
    const lineRegex = new RegExp(escapedTokens[0], "i");
    const bodyLines = content.split("\n");
    const matchLine = bodyLines.find((l) => lineRegex.test(l))?.trim() || "";
    matchedCards.push({ slug: card.slug, matchLine, matchCount, store: card.store, dirPrefix: card.dirPrefix });
  }

  if (matchedCards.length === 0) return { output: "", exitCode: 0 };

  // Sort by match count (most relevant first), take top N
  matchedCards.sort((a, b) => b.matchCount - a.matchCount);
  const topCards = matchedCards.slice(0, limit);

  const results: string[] = [];
  for (const matched of topCards) {
    const raw = await matched.store.readCard(matched.slug);
    const { data, content } = parseFrontmatter(raw);
    const links = extractLinks(content);
    const paragraphs = content.trim().split(/\n\n+/);
    const firstParagraph = paragraphs[0]?.trim() || "";

    const showMatchLine = matched.matchLine && !firstParagraph.includes(matched.matchLine) ? matched.matchLine : null;

    const prefixedSlug = shouldPrefix ? `${matched.dirPrefix}/${matched.slug}` : matched.slug;

    const item = {
      slug: prefixedSlug,
      title: String(data.title || matched.slug),
      firstParagraph,
      matchLine: showMatchLine,
      links,
    };

    results.push(
      options.compact
        ? formatCompactSearchResult(item)
        : formatSearchResult(item)
    );
  }

  return { output: results.join(options.compact ? "\n" : "\n\n"), exitCode: 0 };
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

  // Run keyword matching for hybrid scoring
  const keywordScores = await computeKeywordScores(query, allCards);
  const maxKw = keywordScores.size > 0 ? Math.max(...keywordScores.values()) : 0;

  // Compute scores for all cards
  type ScoredCard = { slug: string; store: CardStore; dirPrefix: string; score: number };
  const scored: ScoredCard[] = [];

  for (const card of allCards) {
    const entry = cache.get(card.slug);
    if (!entry) continue;

    const semScore = cosineSimilarity(queryVector, entry.vector);
    const kwRaw = keywordScores.get(card.slug) ?? 0;
    const kwNormalized = maxKw > 0 ? kwRaw / maxKw : 0;

    // Hybrid scoring: 0.7 * semantic + 0.3 * keywordNormalized
    const finalScore = kwRaw > 0
      ? 0.7 * semScore + 0.3 * kwNormalized
      : semScore;

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

  return { output: results.join(options.compact ? "\n" : "\n\n"), exitCode: 0 };
}

/** Compute keyword match counts per card slug (same logic as keyword search). */
async function computeKeywordScores(
  query: string,
  allCards: Array<{ slug: string; store: CardStore; dirPrefix: string }>,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const tokens = query.split(/\s+/).filter(Boolean);
  const escapedTokens = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

  for (const card of allCards) {
    const raw = await card.store.readCard(card.slug);
    const { data, content } = parseFrontmatter(raw);
    const title = String(data.title || card.slug);
    const searchText = title + "\n" + content;

    const allMatch = escapedTokens.every((t) => new RegExp(t, "i").test(searchText));
    if (!allMatch) continue;

    let matchCount = 0;
    for (const t of escapedTokens) {
      const hits = searchText.match(new RegExp(t, "gi"));
      if (hits) matchCount += hits.length;
    }

    scores.set(card.slug, matchCount);
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
