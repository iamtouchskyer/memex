/**
 * Write-time link suggestion: propose existing cards a new card should link out to.
 *
 * Pure lexical (reuses the search scoring engine) — ZERO network, so it never
 * blocks an offline write. Fixes orphans at their birthplace instead of via a
 * post-hoc cleanup campaign: a new card born with outbound links de-orphans its
 * targets by writing a single file.
 */
import { CardStore } from "./store.js";
import { parseFrontmatter, extractLinks } from "./parser.js";
import { tokenizeQuery, buildSearchableFields, scoreCard } from "./scoring.js";

const SUGGEST_LIMIT = 3;
// Minimum normalizedScore for a card to be offered as a candidate.
//
// PROVENANCE: scoreCard returns normalizedScore = totalScore /
// (effectiveTokens * MAX_FIELD_WEIGHT) — i.e. it is normalized against query
// length, NOT corpus size. 0.08 means "on average the query tokens hit ~8% of
// the maximum possible field weight." Calibrated so a card sharing a title/tag
// term clears the bar while an incidental one-word body overlap does not.
//
// CAVEAT (see suggest-links boundary test): because the denominator scales with
// query length, a very verbose first paragraph dilutes the score and can drop
// otherwise-relevant cards. This is a lexical pre-filter, not a ranker — the
// human still decides whether a candidate deserves a relationship link. If the
// scoring weights in scoring.ts are ever retuned, the boundary test will trip.
const MIN_SCORE = 0.08;

interface CardFrontmatter {
  title?: unknown;
  tags?: unknown;
  tag?: unknown;
  category?: unknown;
}

function firstParagraph(content: string): string {
  const trimmed = content.trim();
  const idx = trimmed.indexOf("\n\n");
  return idx === -1 ? trimmed : trimmed.slice(0, idx);
}

function tagList(data: CardFrontmatter): string[] {
  const raw = data.tags ?? data.tag;
  if (Array.isArray(raw)) return raw.map((t) => String(t).trim()).filter(Boolean);
  if (typeof raw === "string") return raw.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
}

/**
 * Return up to SUGGEST_LIMIT slugs of existing cards most relevant to a new
 * card, excluding the card itself and any target already linked in its body.
 */
export async function suggestLinks(
  store: CardStore,
  slug: string,
  data: CardFrontmatter,
  content: string,
): Promise<string[]> {
  const query = [
    String(data.title || slug),
    tagList(data).join(" "),
    typeof data.category === "string" ? data.category : "",
    firstParagraph(content),
  ]
    .filter(Boolean)
    .join(" ");

  const { tokens, originalTokens } = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const alreadyLinked = new Set(extractLinks(content));
  const cards = await store.scanAll();

  const scored: { slug: string; score: number }[] = [];
  for (const card of cards) {
    if (card.slug === slug || alreadyLinked.has(card.slug)) continue;
    const raw = await store.readCard(card.slug);
    const parsed = parseFrontmatter(raw);
    const fields = buildSearchableFields(
      card.slug,
      parsed.data,
      parsed.content,
      extractLinks(parsed.content),
    );
    const match = scoreCard(tokens, originalTokens, fields);
    if (match && match.score >= MIN_SCORE) {
      scored.push({ slug: card.slug, score: match.score });
    }
  }

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.slug.localeCompare(b.slug)));
  return scored.slice(0, SUGGEST_LIMIT).map((s) => s.slug);
}
