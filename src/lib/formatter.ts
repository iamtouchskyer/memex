export interface CardListItem {
  slug: string;
  title: string;
}

export interface SearchResultItem {
  slug: string;
  title: string;
  firstParagraph: string;
  matchLine: string | null;
  links: string[];
}

export interface LinkStatsItem {
  slug: string;
  outbound: number;
  inbound: number;
}

const HUB_THRESHOLD = 10;

export function formatCardList(cards: CardListItem[]): string {
  if (cards.length === 0) return "";
  const maxSlugLen = Math.max(...cards.map((c) => c.slug.length));
  return cards.map((c) => `${c.slug.padEnd(maxSlugLen + 2)}${c.title}`).join("\n");
}

export function formatSearchResult(result: SearchResultItem): string {
  const lines: string[] = [];
  lines.push(`## ${result.slug}`);
  lines.push(result.title);
  lines.push(result.firstParagraph);
  if (result.matchLine) {
    lines.push(`> 匹配行: ${result.matchLine}`);
  }
  if (result.links.length > 0) {
    lines.push(`Links: ${result.links.map((l) => `[[${l}]]`).join(", ")}`);
  }
  return lines.join("\n");
}

export function formatLinkStats(stats: LinkStatsItem[]): string {
  if (stats.length === 0) return "";
  const maxSlugLen = Math.max(...stats.map((s) => s.slug.length));
  const header = `${"slug".padEnd(maxSlugLen + 2)}${"out".padEnd(5)}${"in".padEnd(5)}status`;
  const rows = stats.map((s) => {
    let status = "";
    if (s.inbound === 0) status = "orphan";
    else if (s.inbound >= HUB_THRESHOLD) status = "hub";
    return `${s.slug.padEnd(maxSlugLen + 2)}${String(s.outbound).padEnd(5)}${String(s.inbound).padEnd(5)}${status}`;
  });
  return [header, ...rows].join("\n");
}

export function formatCompactSearchResult(result: SearchResultItem, score?: number): string {
  const scorePart = score !== undefined ? `  [${score.toFixed(2)}]` : "";
  return `${result.slug}  ${result.title}${scorePart}`;
}

export function formatCardLinks(slug: string, outbound: string[], inbound: string[]): string {
  const lines: string[] = [];
  lines.push(`## ${slug}`);
  lines.push(`Outbound: ${outbound.map((l) => `[[${l}]]`).join(", ") || "(none)"}`);
  lines.push(`Inbound:  ${inbound.map((l) => `[[${l}]]`).join(", ") || "(none)"}`);
  return lines.join("\n");
}
