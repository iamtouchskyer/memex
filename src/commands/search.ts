import { CardStore } from "../lib/store.js";
import { parseFrontmatter, extractLinks } from "../lib/parser.js";
import { formatCardList, formatSearchResult } from "../lib/formatter.js";
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

/** Default weight for semantic score in hybrid ranking. */
const DEFAULT_SEMANTIC_WEIGHT = 0.7;

interface SearchOptions {
  limit?: number;
  all?: boolean;
  config?: MemexConfig;
  memexHome?: string;
  semantic?: boolean;
  /** Override embedding provider (for testing). */
  _embeddingProvider?: EmbeddingProvider;
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
  const allCards: Array<{ slug: string; store: CardStore; dirPrefix: string }> = [];
  for (const { store: s, dirPrefix } of storesToSearch) {
    const cards = await s.scanAll();
    for (const card of cards) {
      allCards.push({ slug: card.slug, store: s, dirPrefix });
    }
  }

  if (allCards.length === 0) return { output: "", exitCode: 0 };

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

    results.push(
      formatSearchResult({
        slug: prefixedSlug,
        title: String(data.title || matched.slug),
        firstParagraph,
        matchLine: showMatchLine,
        links,
      })
    );
  }

  return { output: results.join("\n\n"), exitCode: 0 };
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
        localModelPath: options.config?.localModelPath,
        ollamaModel: options.config?.ollamaModel,
        ollamaBaseUrl: options.config?.ollamaBaseUrl,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: message, exitCode: 1 };
    }
  }

  // Resolve semantic weight from config (default 0.7)
  const semanticWeight = options.config?.semanticWeight ?? DEFAULT_SEMANTIC_WEIGHT;
  const keywordWeight = 1 - semanticWeight;

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

    // Hybrid scoring: semanticWeight * semantic + keywordWeight * keywordNormalized
    const finalScore = kwRaw > 0
      ? semanticWeight * semScore + keywordWeight * kwNormalized
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

    results.push(
      formatSearchResult({
        slug: prefixedSlug,
        title: String(data.title || card.slug),
        firstParagraph,
        matchLine: null,
        links,
      })
    );
  }

  return { output: results.join("\n\n"), exitCode: 0 };
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